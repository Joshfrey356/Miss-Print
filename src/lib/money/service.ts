import "server-only";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { customers, invoiceItems, invoices, jobItems, jobs, payments, type PaymentMethod } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { addDays, invoiceNo, jobNo, money, today } from "@/lib/format";
import { taxFor } from "@/lib/pricing/engine";
import { UserError } from "@/lib/actions";
import { PAYMENT_METHOD_LABELS } from "./labels";

type Actor = { id: number; name: string };

export const TERMS_DAYS = { due_on_receipt: 0, net_15: 15, net_30: 30, net_45: 45, net_60: 60 } as const;
export const TERMS_LABELS = { due_on_receipt: "Due on receipt", net_15: "Net 15", net_30: "Net 30", net_45: "Net 45", net_60: "Net 60" } as const;
// Labels live in ./labels (client-safe); re-exported here so existing imports keep working.
export { PAYMENT_METHOD_LABELS };

export const balanceOf = (inv: { totalCents: number; paidCents: number; status: string }) =>
  inv.status === "void" ? 0 : Math.max(0, inv.totalCents - inv.paidCents);

export const isInvoiceOverdue = (inv: { dueDate: string; status: string }, now = today()) =>
  (inv.status === "sent" || inv.status === "partial") && inv.dueDate < now;

export type AgingBucket = "current" | "1_30" | "31_60" | "61_90" | "90_plus";
export const AGING_LABELS: Record<AgingBucket, string> = { current: "Current", "1_30": "1–30 days", "31_60": "31–60", "61_90": "61–90", "90_plus": "90+" };
export function agingBucket(dueDate: string, now = today()): AgingBucket {
  const days = Math.round((Date.parse(now) - Date.parse(dueDate)) / 86400000);
  if (days <= 0) return "current";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "90_plus";
}

/** Create an invoice from a job's line items. One active invoice per job. */
export async function createInvoiceFromJob(jobId: number, actor: Actor): Promise<{ id: number; number: number }> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
    if (!job) throw new UserError("Job not found.");
    const [existing] = await tx
      .select({ id: invoices.id, number: invoices.number })
      .from(invoices)
      .where(and(eq(invoices.jobId, jobId), ne(invoices.status, "void")));
    if (existing) return existing;
    const [cust] = await tx.select().from(customers).where(eq(customers.id, job.customerId));
    if (cust!.poRequired && !job.poNumber) throw new UserError(`${cust!.name} requires a PO number. Add it to the job first.`);
    const items = await tx.select().from(jobItems).where(eq(jobItems.jobId, jobId)).orderBy(asc(jobItems.sortOrder));
    if (!items.length) throw new UserError("This job has no line items to invoice.");
    const subtotal = items.reduce((a, i) => a + i.priceCents, 0);
    const taxable = items.filter((i) => i.taxable).reduce((a, i) => a + i.priceCents, 0);
    const tax = taxFor(taxable, job.taxRate, cust!.taxExempt);
    const issue = today();
    const [inv] = await tx
      .insert(invoices)
      .values({
        customerId: job.customerId,
        jobId: job.id,
        status: "sent",
        issueDate: issue,
        dueDate: addDays(issue, TERMS_DAYS[cust!.paymentTerms]),
        poNumber: job.poNumber,
        subtotalCents: subtotal,
        taxRate: cust!.taxExempt ? 0 : job.taxRate,
        taxCents: tax,
        totalCents: subtotal + tax,
        createdBy: actor.id,
      })
      .returning();
    await tx.insert(invoiceItems).values(
      items.map((i, idx) => ({ invoiceId: inv!.id, description: i.description, quantity: i.quantity, amountCents: i.priceCents, taxable: i.taxable, sortOrder: idx })),
    );
    await logActivity(
      { action: "invoice.created", entityType: "invoice", entityId: inv!.id, jobId: job.id, customerId: job.customerId, actorId: actor.id, summary: `Created invoice ${invoiceNo(inv!.number)} for ${money(subtotal + tax)}` },
      tx,
    );
    return { id: inv!.id, number: inv!.number };
  });
}

/** Recompute paid amount + status from non-void payments. */
export async function recalcInvoicePaid(tx: Tx, invoiceId: number) {
  const [{ paid }] = await tx
    .select({ paid: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int` })
    .from(payments)
    .where(and(eq(payments.invoiceId, invoiceId), isNull(payments.voidedAt)));
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv || inv.status === "void") return;
  const status = paid >= inv.totalCents && inv.totalCents > 0 ? "paid" : paid > 0 ? "partial" : inv.status === "draft" ? "draft" : "sent";
  await tx.update(invoices).set({ paidCents: paid, status }).where(eq(invoices.id, invoiceId));
}

export async function recordPayment(
  invoiceId: number,
  p: { amountCents: number; method: PaymentMethod; reference?: string | null; receivedOn: string; notes?: string | null },
  actor: Actor,
) {
  if (!(p.amountCents > 0)) throw new UserError("Enter a payment amount.");
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
    if (!inv) throw new UserError("Invoice not found.");
    if (inv.status === "void") throw new UserError("This invoice is void.");
    const balance = balanceOf(inv);
    if (p.amountCents > balance) throw new UserError(`That's more than the ${money(balance)} balance.`);
    const [pay] = await tx
      .insert(payments)
      .values({ invoiceId, customerId: inv.customerId, amountCents: p.amountCents, method: p.method, reference: p.reference ?? null, receivedOn: p.receivedOn, notes: p.notes ?? null, recordedBy: actor.id })
      .returning();
    await recalcInvoicePaid(tx, invoiceId);
    const [job] = inv.jobId ? await tx.select({ number: jobs.number }).from(jobs).where(eq(jobs.id, inv.jobId)) : [];
    await logActivity(
      {
        action: "payment.received",
        entityType: "payment",
        entityId: pay!.id,
        jobId: inv.jobId,
        customerId: inv.customerId,
        actorId: actor.id,
        summary: `Payment of ${money(p.amountCents)} received (${PAYMENT_METHOD_LABELS[p.method]}) on ${invoiceNo(inv.number)}${job ? ` · ${jobNo(job.number)}` : ""}`,
      },
      tx,
    );
    return pay!;
  });
}

/** Financial records are never deleted — they are voided with a reason. */
export async function voidInvoice(invoiceId: number, reason: string, actor: Actor) {
  if (!reason.trim()) throw new UserError("Enter a reason for voiding.");
  await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
    if (!inv) throw new UserError("Invoice not found.");
    if (inv.paidCents > 0) throw new UserError("This invoice has payments. Void the payments first.");
    await tx.update(invoices).set({ status: "void", voidedAt: new Date(), voidReason: reason.trim() }).where(eq(invoices.id, invoiceId));
    await logActivity(
      { action: "invoice.voided", entityType: "invoice", entityId: inv.id, jobId: inv.jobId, customerId: inv.customerId, actorId: actor.id, summary: `Voided ${invoiceNo(inv.number)}: ${reason.trim()}`, data: { before: { status: inv.status }, after: { status: "void" } } },
      tx,
    );
  });
}

export async function voidPayment(paymentId: number, reason: string, actor: Actor) {
  if (!reason.trim()) throw new UserError("Enter a reason for voiding.");
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!p || p.voidedAt) throw new UserError("Payment not found.");
    await tx.update(payments).set({ voidedAt: new Date(), notes: [p.notes, `VOID: ${reason.trim()}`].filter(Boolean).join("\n") }).where(eq(payments.id, paymentId));
    await recalcInvoicePaid(tx, p.invoiceId);
    const [inv] = await tx.select({ number: invoices.number, jobId: invoices.jobId }).from(invoices).where(eq(invoices.id, p.invoiceId));
    await logActivity(
      {
        action: "payment.voided",
        entityType: "payment",
        entityId: p.id,
        jobId: inv?.jobId ?? null,
        customerId: p.customerId,
        actorId: actor.id,
        summary: `Voided payment of ${money(p.amountCents)}${inv ? ` on ${invoiceNo(inv.number)}` : ""}: ${reason.trim()}`,
        data: { invoiceId: p.invoiceId },
      },
      tx,
    );
  });
}
