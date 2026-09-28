/**
 * How our records become QuickBooks Online records (pure — unit tested in tests/quickbooks.test.ts).
 *
 * Decisions:
 * - Invoice DocNumber = the number as printed on our invoice, "INV-7001" (invoiceNo()). It is what the
 *   customer sees and quotes when paying, and the prefix keeps it from colliding with invoices the shop
 *   typed into QuickBooks by hand before connecting. (QuickBooks must have "Custom transaction numbers"
 *   turned on under Account and settings → Sales, or it numbers invoices itself.)
 * - Every line uses one service Item, "Printing & Services"; the line's Description, Qty and Amount
 *   carry the detail.
 * - Sales tax (US companies): each line is marked TaxCodeRef "TAX" or "NON". QuickBooks then works out
 *   the tax itself from ITS OWN settings (Automated Sales Tax), so its total can differ from ours; we
 *   compare the totals and keep a note when they don't match. Lines are only "TAX" when our invoice
 *   actually charged tax (taxable line, customer not exempt, tax > 0), so an untaxed invoice stays untaxed.
 */
import { invoiceNo } from "../../format";

export type LocalCustomer = {
  id: number;
  name: string;
  isCompany: boolean;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  billingAddress: string | null;
  taxExempt: boolean;
};

export type LocalInvoiceItem = { description: string; quantity: number; amountCents: number; taxable: boolean };

export type LocalInvoice = {
  id: number;
  number: number;
  customerId: number;
  status: "draft" | "sent" | "partial" | "paid" | "void";
  issueDate: string;
  dueDate: string;
  poNumber: string | null;
  notes: string | null;
  taxCents: number;
  totalCents: number;
  items: LocalInvoiceItem[];
};

export type LocalPayment = {
  id: number;
  invoiceId: number;
  customerId: number;
  amountCents: number;
  method: "cash" | "check" | "card" | "ach" | "other";
  reference: string | null;
  receivedOn: string;
  notes: string | null;
  voidedAt: Date | null;
};

/** The service Item every invoice line points to. */
export const QBO_ITEM_NAME = "Printing & Services";

export const dollars = (cents: number) => Math.round(cents) / 100;
export const cents = (amount: unknown) => Math.round(Number(amount ?? 0) * 100);

/** Escape a value for a QuickBooks query string literal: backslash and single quote get a backslash. */
export const escapeQbo = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/**
 * QuickBooks DisplayName: unique per company, no colons/tabs/newlines (colons mean "sub-customer"),
 * at most 500 characters.
 */
export function qboDisplayName(name: string, fallbackId?: number): string {
  const clean = name
    .replace(/[:\t\r\n]+/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/^[\s-]+|[\s-]+$/g, "")
    .slice(0, 500);
  return clean || (fallbackId != null ? `Customer ${fallbackId}` : "Customer");
}

export const qboCustomerQuery = (displayName: string) =>
  `select * from Customer where DisplayName = '${escapeQbo(displayName)}' and Active in (true, false)`;

export const qboDocNumber = (invoiceNumber: number) => invoiceNo(invoiceNumber).slice(0, 21);

type QboAddr = { Line1?: string; Line2?: string; Line3?: string; Line4?: string; Line5?: string; City?: string; CountrySubDivisionCode?: string; PostalCode?: string };

/** A free-form address block ("123 Main St\nHammond, IN 46320") or the separate street/city/state/zip. */
export function qboAddress(c: Pick<LocalCustomer, "address" | "city" | "state" | "zip" | "billingAddress">): QboAddr | undefined {
  const block = c.billingAddress?.trim();
  if (block) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 5);
    const out: QboAddr = {};
    lines.forEach((l, i) => ((out as Record<string, string>)[`Line${i + 1}`] = l.slice(0, 500)));
    return lines.length ? out : undefined;
  }
  const a: QboAddr = {};
  if (c.address?.trim()) a.Line1 = c.address.trim().slice(0, 500);
  if (c.city?.trim()) a.City = c.city.trim().slice(0, 255);
  if (c.state?.trim()) a.CountrySubDivisionCode = c.state.trim().slice(0, 255);
  if (c.zip?.trim()) a.PostalCode = c.zip.trim().slice(0, 30);
  return Object.keys(a).length ? a : undefined;
}

export function customerBody(c: LocalCustomer, displayName = qboDisplayName(c.name, c.id)): Record<string, unknown> {
  const body: Record<string, unknown> = { DisplayName: displayName };
  if (c.isCompany) body.CompanyName = c.name.slice(0, 100);
  if (c.email?.trim()) body.PrimaryEmailAddr = { Address: c.email.trim().slice(0, 100) };
  if (c.phone?.trim()) body.PrimaryPhone = { FreeFormNumber: c.phone.trim().slice(0, 30) };
  if (c.website?.trim()) body.WebAddr = { URI: c.website.trim().slice(0, 1000) };
  const addr = qboAddress(c);
  if (addr) body.BillAddr = addr;
  return body;
}

/** Qty × UnitPrice must equal Amount in QuickBooks; if a clean unit price doesn't exist, send Qty 1. */
export function lineQtyPrice(quantity: number, amountCents: number): { Qty: number; UnitPrice: number; qtyInDescription: boolean } {
  const q = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const unit = Math.round((amountCents / q / 100) * 1e5) / 1e5;
  // Exact (not just after rounding), so QuickBooks' "Amount = UnitPrice × Qty" check can't fail.
  if (Math.abs(unit * q * 100 - amountCents) < 1e-6) return { Qty: q, UnitPrice: unit, qtyInDescription: false };
  return { Qty: 1, UnitPrice: dollars(amountCents), qtyInDescription: q !== 1 };
}

export type InvoiceMapOptions = { customerRef: string; itemRef: { value: string; name?: string }; customerTaxExempt: boolean; usTaxCodes: boolean; customerEmail?: string | null };

export function invoiceBody(inv: LocalInvoice, o: InvoiceMapOptions): Record<string, unknown> {
  const charged = inv.taxCents > 0 && !o.customerTaxExempt;
  const Line = inv.items.map((it) => {
    const qp = lineQtyPrice(it.quantity, it.amountCents);
    const desc = (it.description || "Item") + (qp.qtyInDescription ? ` (qty ${it.quantity})` : "");
    const detail: Record<string, unknown> = { ItemRef: o.itemRef, Qty: qp.Qty, UnitPrice: qp.UnitPrice };
    if (o.usTaxCodes) detail.TaxCodeRef = { value: it.taxable && charged ? "TAX" : "NON" };
    return { DetailType: "SalesItemLineDetail", Amount: dollars(it.amountCents), Description: desc.slice(0, 4000), SalesItemLineDetail: detail };
  });
  const body: Record<string, unknown> = {
    CustomerRef: { value: o.customerRef },
    DocNumber: qboDocNumber(inv.number),
    TxnDate: inv.issueDate,
    DueDate: inv.dueDate,
    Line,
  };
  if (inv.poNumber?.trim()) body.CustomerMemo = { value: `PO ${inv.poNumber.trim()}`.slice(0, 1000) };
  if (inv.notes?.trim()) body.PrivateNote = inv.notes.trim().slice(0, 4000);
  if (o.customerEmail?.trim()) body.BillEmail = { Address: o.customerEmail.trim().slice(0, 100) };
  return body;
}

/** A note when QuickBooks' total (it computes sales tax itself) differs from ours. */
export function totalMismatch(ourTotalCents: number, qboTotalAmt: unknown): string | null {
  if (qboTotalAmt == null) return null;
  const theirs = cents(qboTotalAmt);
  if (theirs === ourTotalCents) return null;
  const fmt = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return `QuickBooks total is ${fmt(theirs)} but ours is ${fmt(ourTotalCents)}. QuickBooks figures sales tax from its own tax settings — check the tax rate there.`;
}

/** QuickBooks payment method names we try, in order, for each of our methods. */
export const QBO_PAYMENT_METHOD_NAMES: Record<LocalPayment["method"], string[]> = {
  cash: ["Cash"],
  check: ["Check", "Cheque"],
  card: ["Credit Card", "Card", "Visa"],
  ach: ["ACH", "Bank Transfer", "EFT", "Direct Deposit"],
  other: [],
};

export function pickPaymentMethod(method: LocalPayment["method"], available: { Id: string; Name?: string; Active?: boolean }[]): string | null {
  for (const name of QBO_PAYMENT_METHOD_NAMES[method]) {
    const m = available.find((a) => a.Active !== false && a.Name?.trim().toLowerCase() === name.toLowerCase());
    if (m) return m.Id;
  }
  return null;
}

export function paymentBody(p: LocalPayment, o: { customerRef: string; invoiceRef: string; paymentMethodRef?: string | null }): Record<string, unknown> {
  const body: Record<string, unknown> = {
    CustomerRef: { value: o.customerRef },
    TotalAmt: dollars(p.amountCents),
    TxnDate: p.receivedOn,
    Line: [{ Amount: dollars(p.amountCents), LinkedTxn: [{ TxnId: o.invoiceRef, TxnType: "Invoice" }] }],
  };
  if (o.paymentMethodRef) body.PaymentMethodRef = { value: o.paymentMethodRef };
  if (p.reference?.trim()) body.PaymentRefNum = p.reference.trim().slice(0, 21);
  if (p.notes?.trim()) body.PrivateNote = p.notes.trim().slice(0, 4000);
  return body;
}
