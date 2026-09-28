/**
 * The plain-text purchase order emailed to a vendor. Pure (unit-tested).
 */
import { fmtDate, money, poNo } from "@/lib/format";
import { fmtQty, fmtUnitCost, unitLabel } from "./math";

export type PoEmailInput = {
  company: { name: string; phone?: string; email?: string; address?: string };
  vendor: { name: string; contactName?: string | null; accountNumber?: string | null };
  po: { number: number; orderedOn: string | null; expectedOn: string | null; notes: string | null; subtotalCents: number; shippingCents: number; taxCents: number; totalCents: number };
  deliverTo: { name: string; address: string | null } | null;
  lines: { description: string; sku?: string | null; quantity: number; unit: string | null; unitCostCents: number; amountCents: number }[];
  /** Extra words from the person sending it. */
  message?: string | null;
};

export function poEmail(i: PoEmailInput): { subject: string; text: string } {
  const n = poNo(i.po.number);
  const subject = `Purchase order ${n} from ${i.company.name}`;
  const L: string[] = [];
  L.push(i.vendor.contactName ? `Hi ${i.vendor.contactName.split(" ")[0]},` : `Hello ${i.vendor.name},`);
  L.push("");
  L.push(`Please supply the following on our purchase order ${n}. Put ${n} on the packing slip and invoice.`);
  if (i.message?.trim()) L.push("", i.message.trim());
  L.push("");
  L.push(`PURCHASE ORDER ${n}`);
  if (i.po.orderedOn) L.push(`Date: ${fmtDate(i.po.orderedOn, { year: true, weekday: false })}`);
  if (i.vendor.accountNumber) L.push(`Our account #: ${i.vendor.accountNumber}`);
  if (i.po.expectedOn) L.push(`Needed by: ${fmtDate(i.po.expectedOn, { year: true, weekday: true })}`);
  L.push("");
  i.lines.forEach((l, idx) => {
    const qty = `${fmtQty(l.quantity)}${l.unit ? ` ${unitLabel(l.unit, l.quantity)}` : ""}`;
    L.push(`${idx + 1}. ${l.description}${l.sku ? ` (item # ${l.sku})` : ""}`);
    L.push(`   ${qty}${l.unitCostCents > 0 ? ` @ ${fmtUnitCost(l.unitCostCents)}${l.unit ? `/${unitLabel(l.unit, 1)}` : ""} = ${money(l.amountCents)}` : ""}`);
  });
  L.push("");
  if (i.po.subtotalCents > 0) {
    L.push(`Subtotal: ${money(i.po.subtotalCents)}`);
    if (i.po.shippingCents) L.push(`Shipping: ${money(i.po.shippingCents)}`);
    if (i.po.taxCents) L.push(`Tax: ${money(i.po.taxCents)}`);
    L.push(`Total: ${money(i.po.totalCents)}`);
    L.push("");
  }
  if (i.deliverTo) {
    L.push("Deliver to:");
    L.push(`${i.company.name} — ${i.deliverTo.name}`);
    if (i.deliverTo.address) L.push(i.deliverTo.address);
    L.push("");
  }
  if (i.po.notes?.trim()) L.push("Notes:", i.po.notes.trim(), "");
  L.push("Please reply to confirm the order and the delivery date.");
  L.push("");
  L.push("Thank you,");
  L.push(i.company.name);
  const contact = [i.company.phone, i.company.email].filter(Boolean).join(" · ");
  if (contact) L.push(contact);
  return { subject, text: L.join("\n") };
}
