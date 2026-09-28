/** Receipt text for email. Pure (no database) so it's easy to check. */
import { fmtDate, invoiceNo, jobNo, money } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/money/labels";
import type { PaymentMethod } from "@/lib/db/schema";
import { changeDue } from "./math";

type Company = { name: string; tagline: string; phone: string; email: string; website: string; address: string };
type ReceiptSale = {
  inv: { number: number; issueDate: string; subtotalCents: number; taxCents: number; taxRate: number; totalCents: number; paidCents: number; status: string };
  customer: { name: string };
  job: { number: number } | null;
  items: { description: string; quantity: number; amountCents: number }[];
  payments: { p: { method: PaymentMethod; amountCents: number; tenderedCents: number | null; reference: string | null; voidedAt: Date | null; receivedOn: string } }[];
};

/** `jobPrefix` is the shop's job number prefix (tenants.jobPrefix). */
export function receiptEmail({ company, sale, jobPrefix }: { company: Company; sale: ReceiptSale; jobPrefix: string }) {
  const { inv } = sale;
  const balance = inv.status === "void" ? 0 : Math.max(0, inv.totalCents - inv.paidCents);
  const pays = sale.payments.filter((x) => !x.p.voidedAt).map((x) => x.p);
  const w = 34;
  const row = (l: string, r: string) => `${l}${" ".repeat(Math.max(1, w - l.length - r.length))}${r}`;
  const lines = [
    `Hi ${sale.customer.name === "Walk-in" ? "there" : sale.customer.name},`,
    "",
    `Thanks for your business! Here's your receipt for ${invoiceNo(inv.number)} (${fmtDate(inv.issueDate, { year: true })}).`,
    "",
    ...sale.items.map((i) => row(`${i.quantity > 1 ? `${i.quantity.toLocaleString()} × ` : ""}${i.description}`.slice(0, w - 11), money(i.amountCents))),
    "",
    row("Subtotal", money(inv.subtotalCents)),
    row(`Sales tax${inv.taxRate ? ` (${(inv.taxRate * 100).toFixed(2).replace(/\.?0+$/, "")}%)` : ""}`, money(inv.taxCents)),
    row("Total", money(inv.totalCents)),
    ...pays.flatMap((p) => {
      const out = [row(`Paid – ${PAYMENT_METHOD_LABELS[p.method]}${p.reference ? ` (${p.reference})` : ""}`.slice(0, w - 11), money(p.amountCents))];
      const change = changeDue(p);
      if (change > 0) out.push(row(`  Cash given ${money(p.tenderedCents)}`, `change ${money(change)}`));
      return out;
    }),
    balance > 0 ? row("Balance due", money(balance)) : "PAID IN FULL",
    sale.job ? `\nYour order is ${jobNo(sale.job.number, jobPrefix)}. We'll let you know when it's ready.` : "",
    "",
    company.name,
    company.address,
    [company.phone, company.email, company.website].filter(Boolean).join(" · "),
  ];
  return { subject: `Your receipt from ${company.name} — ${invoiceNo(inv.number)}`, text: lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n") };
}
