import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { communications, customers, invoiceItems, invoices, jobItems, jobStatusHistory, jobs, payments, registerCloses, type PaymentMethod } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { queueAccountingSync } from "@/lib/accounting";
import { UserError } from "@/lib/actions";
import { emailProvider } from "@/lib/email";
import { fmtDate, invoiceNo, money, today } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { getJobPrefix, nextNumber } from "@/lib/tenant";
import { changeJobStatus, convertQuoteToJob } from "@/lib/jobs/service";
import { createInvoiceFromJob, recordPayment, voidInvoice } from "@/lib/money/service";
import { cartTotals, cashPayment, dayTotals, overShort, overShortLabel } from "./math";
import { dayPayments, getCounterSale } from "./queries";
import { receiptEmail } from "./receipt";
import { priceCounterItem } from "./pricing";

type Actor = { id: number; name: string; locationId?: number | null };

/** Name of the shared customer used for walk-in sales (one per shop, made the first time it's needed). */
export const WALK_IN_NAME = "Walk-in";

export type SaleLineInput = {
  description: string;
  quantity: number;
  amountCents: number;
  taxable: boolean;
  categoryId?: number | null;
  widthIn?: number | null;
  heightIn?: number | null;
  recommendedCents?: number | null;
  /** Print categories: sides and paper chosen at the counter. */
  print?: { pages: 1 | 2; paperId: number | null } | null;
};

export type SaleInput = {
  /** null = walk-in customer */
  customerId: number | null;
  lines: SaleLineInput[];
  poNumber?: string | null;
  notes?: string | null;
  /** Also put it on the production board as a new job. */
  production?: { title: string; dueDate: string | null; instructions: string | null } | null;
};

/** The shop's walk-in customer: reused, created the first time (a lock stops two being made at once). */
export async function walkInCustomerId(tenantId: number): Promise<number> {
  const find = async (q: Tx | typeof db) =>
    (
      await q
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), eq(customers.name, WALK_IN_NAME), isNull(customers.archivedAt)))
        .orderBy(asc(customers.id))
        .limit(1)
    )[0]?.id;
  const found = await find(db);
  if (found) return found;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${tenantId}::int, 7301)`);
    const again = await find(tx);
    if (again) return again;
    const [c] = await tx
      .insert(customers)
      .values({ tenantId, name: WALK_IN_NAME, isCompany: false, paymentTerms: "due_on_receipt", notes: "Shared customer for walk-in sales at the front counter." })
      .returning({ id: customers.id });
    await logActivity({ tenantId, action: "customer.created", entityType: "customer", entityId: c!.id, customerId: c!.id, summary: "Created the “Walk-in” customer for counter sales" }, tx);
    return c!.id;
  });
}

/**
 * Ring up a counter sale: an invoice (source "counter", due on receipt) with the lines as entered,
 * tax at the shop's rate (unless the customer is tax exempt) and, if it needs production, a new job
 * on the production board linked to the invoice. Payment is taken next (takeCounterPayment).
 */
export async function createCounterSale(tenantId: number, input: SaleInput, actor: Actor): Promise<{ id: number; number: number; jobNumber: number | null }> {
  const lines = input.lines.filter((l) => l.description.trim());
  if (!lines.length) throw new UserError("Add at least one item to the sale.");
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 10_000_000) throw new UserError(`Check the quantity for “${l.description}”.`);
    if (!Number.isInteger(l.amountCents) || l.amountCents < 0 || l.amountCents > 100_000_000) throw new UserError(`Check the price for “${l.description}”.`);
  }
  const customerId = input.customerId ?? (await walkInCustomerId(tenantId));
  const [cust] = await db.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId), isNull(customers.archivedAt)));
  if (!cust) throw new UserError("Customer not found.");
  const po = input.poNumber?.trim() || null;
  if (cust.poRequired && !po) throw new UserError(`${cust.name} requires a PO number.`);
  const { rules } = await getSettings(tenantId);
  const t = cartTotals(lines, rules.taxRate, cust.taxExempt);
  if (t.totalCents <= 0) throw new UserError("The sale total is $0. Enter a price.");
  const issue = today();
  // Printed items going to production: keep how they run (press, paper, sheets) for the job ticket.
  const runInfo = input.production
    ? await Promise.all(
        lines.map((l) =>
          l.print && l.categoryId && l.widthIn && l.heightIn
            ? priceCounterItem(tenantId, { categoryId: l.categoryId, quantity: l.quantity, widthIn: l.widthIn, heightIn: l.heightIn, customerId, print: l.print }).catch(() => null)
            : Promise.resolve(null),
        ),
      )
    : [];

  const sale = await db.transaction(async (tx) => {
    const number = await nextNumber(tx, tenantId, "invoice");
    const [inv] = await tx
      .insert(invoices)
      .values({
        tenantId,
        number,
        customerId,
        status: "sent",
        issueDate: issue,
        dueDate: issue,
        poNumber: po,
        subtotalCents: t.subtotalCents,
        taxRate: t.taxRate,
        taxCents: t.taxCents,
        totalCents: t.totalCents,
        notes: input.notes?.trim() || null,
        source: "counter",
        createdBy: actor.id,
      })
      .returning();
    await tx.insert(invoiceItems).values(
      lines.map((l, i) => ({ tenantId, invoiceId: inv!.id, description: l.description.trim(), quantity: l.quantity, amountCents: l.amountCents, taxable: l.taxable, sortOrder: i })),
    );
    await logActivity(
      { tenantId, action: "invoice.created", entityType: "invoice", entityId: inv!.id, customerId, actorId: actor.id, summary: `Counter sale ${invoiceNo(number)} for ${money(t.totalCents)}`, data: { source: "counter" } },
      tx,
    );

    let jobNumber: number | null = null;
    if (input.production) {
      const title = input.production.title.trim() || lines[0]!.description.trim();
      jobNumber = await nextNumber(tx, tenantId, "job");
      const [job] = await tx
        .insert(jobs)
        .values({
          tenantId,
          number: jobNumber,
          customerId,
          title: title.slice(0, 200),
          categoryId: lines.find((l) => l.categoryId)?.categoryId ?? null,
          description: input.production.instructions?.trim() || null,
          status: "new",
          locationId: actor.locationId ?? null,
          fulfillment: "pickup",
          needsDesign: false,
          needsProof: false,
          salespersonId: actor.id,
          dueDate: input.production.dueDate,
          poNumber: po,
          subtotalCents: t.subtotalCents,
          taxRate: t.taxRate,
          taxCents: t.taxCents,
          totalCents: t.totalCents,
          internalNotes: `Sold at the front counter on ${invoiceNo(number)}.`,
          createdBy: actor.id,
        })
        .returning();
      await tx.insert(jobItems).values(
        lines.map((l, i) => ({
          tenantId,
          jobId: job!.id,
          categoryId: l.categoryId ?? null,
          description: l.description.trim(),
          quantity: l.quantity,
          widthIn: l.widthIn ?? null,
          heightIn: l.heightIn ?? null,
          priceCents: l.amountCents,
          recommendedCents: l.recommendedCents ?? l.amountCents,
          pricingInput: runInfo[i]?.sheetFed ? runInfo[i]!.request : null,
          pricingBreakdown: runInfo[i]?.breakdown ?? null,
          estimatedCostCents: runInfo[i]?.sheetFed ? runInfo[i]!.result.estimatedCostCents : 0,
          overrideReason: l.recommendedCents != null && l.recommendedCents !== l.amountCents ? "Price changed at the counter" : null,
          taxable: l.taxable,
          sortOrder: i,
        })),
      );
      await tx.update(invoices).set({ jobId: job!.id }).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, inv!.id)));
      await tx.insert(jobStatusHistory).values({ tenantId, jobId: job!.id, fromStatus: null, toStatus: "new", changedBy: actor.id, note: "Job created at the front counter" });
      await logActivity(
        { tenantId, action: "job.created", entityType: "job", entityId: job!.id, jobId: job!.id, customerId, actorId: actor.id, summary: `Created at the front counter (${invoiceNo(number)})` },
        tx,
      );
    }
    return { id: inv!.id, number, jobNumber };
  });
  // QuickBooks (if connected): same as invoices made in Money.
  await queueAccountingSync(tenantId, [{ type: "invoice", id: sale.id }]);
  return sale;
}

export type CounterPaymentInput = {
  method: Extract<PaymentMethod, "cash" | "check" | "card">;
  /** How much to put on the invoice with this method. */
  amountCents: number;
  /** Cash only: what the customer handed over. */
  tenderedCents?: number | null;
  reference?: string | null;
};

/** Take a cash / check / card-terminal payment at the counter. Split payments = call it once per method. */
export async function takeCounterPayment(tenantId: number, invoiceId: number, p: CounterPaymentInput, actor: Actor) {
  let applied = Math.round(p.amountCents);
  let change = 0;
  let tendered: number | null = null;
  if (p.method === "cash") {
    const t = p.tenderedCents == null ? applied : Math.round(p.tenderedCents);
    const r = cashPayment(applied, t);
    applied = r.appliedCents;
    change = r.changeCents;
    tendered = t > applied ? t : null;
  }
  if (!(applied > 0)) throw new UserError("Enter the amount.");
  const reference =
    p.method === "check" ? (p.reference?.trim() ? `Check #${p.reference.trim().replace(/^#/, "")}` : null) : p.method === "card" ? (p.reference?.trim() ? `Card …${p.reference.trim().replace(/\D/g, "").slice(-4)}` : "Card (terminal)") : null;
  const pay = await recordPayment(tenantId, invoiceId, { amountCents: applied, method: p.method, reference, receivedOn: today(), notes: p.method === "card" ? "Card on the shop's terminal, at the counter" : "At the counter" }, actor);
  // The money module records the sale amount; keep what was handed over for the receipt (change).
  if (tendered != null) await db.update(payments).set({ tenderedCents: tendered }).where(and(eq(payments.tenantId, tenantId), eq(payments.id, pay.id)));
  return { paymentId: pay.id, appliedCents: applied, changeCents: change };
}

/** Undo a counter sale nobody has paid on yet: the invoice is voided (never deleted) and its job cancelled. */
export async function cancelCounterSale(tenantId: number, invoiceId: number, actor: Actor & { tenantId: number }) {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)));
  if (!inv) throw new UserError("Sale not found.");
  if (inv.source !== "counter") throw new UserError("Only counter sales can be cancelled here. Void the invoice in Money instead.");
  if (inv.paidCents > 0) throw new UserError("This sale has payments. Void the payments first (Money → invoice).");
  await voidInvoice(tenantId, invoiceId, "Sale cancelled at the counter", actor);
  if (inv.jobId) {
    await db.transaction(async (tx) => {
      const [job] = await tx.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, inv.jobId!))).for("update");
      if (job && job.status === "new") await changeJobStatus(tx, job, "cancelled", actor, { reason: `counter sale ${invoiceNo(inv.number)} cancelled` });
    });
  }
}

/** "Take deposit" on a job: its invoice (made now if needed) — then a partial payment is taken on it. */
export async function invoiceForJob(tenantId: number, jobId: number, actor: Actor) {
  return createInvoiceFromJob(tenantId, jobId, actor);
}

/** "Take deposit" on a quote: it becomes a job (as usual), the job gets its invoice. */
export async function invoiceForQuote(tenantId: number, quoteId: number, actor: Actor) {
  const { number } = await convertQuoteToJob(quoteId, { id: actor.id, name: actor.name, tenantId });
  const [job] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.number, number)));
  if (!job) throw new UserError("Job not found.");
  return { ...(await createInvoiceFromJob(tenantId, job.id, actor)), jobNumber: number };
}

/** Email a receipt for an invoice (counter sale or not) to the customer. */
export async function emailReceipt(tenantId: number, invoiceId: number, to: string, actor: Actor) {
  const sale = await getCounterSale(tenantId, invoiceId);
  if (!sale) throw new UserError("Sale not found.");
  const [{ company }, jobPrefix] = await Promise.all([getSettings(tenantId), getJobPrefix(tenantId)]);
  const { subject, text } = receiptEmail({ company, sale, jobPrefix });
  const result = await emailProvider().send({ to, subject, text, fromName: company.name, replyTo: company.email || undefined });
  await db.transaction(async (tx) => {
    await tx.insert(communications).values({
      tenantId,
      customerId: sale.inv.customerId,
      jobId: sale.inv.jobId,
      invoiceId: sale.inv.id,
      channel: "email",
      direction: "outbound",
      template: "receipt",
      toAddress: to,
      subject,
      body: text,
      status: result.ok ? "sent" : "failed",
      providerId: result.providerId ?? null,
      sentBy: actor.id,
    });
    if (result.ok)
      await logActivity(
        { tenantId, action: "invoice.receipt_sent", entityType: "invoice", entityId: sale.inv.id, jobId: sale.inv.jobId, customerId: sale.inv.customerId, actorId: actor.id, summary: `Emailed a receipt for ${invoiceNo(sale.inv.number)} to ${to}` },
        tx,
      );
  });
  if (!result.ok) {
    console.error("[receipt email]", result.error);
    throw new UserError("The email couldn't be sent. Please try again in a few minutes.");
  }
  return { to };
}

/** Save the end-of-day drawer count. Totals come from the day's (non-voided) payments at save time. */
export async function closeRegister(
  tenantId: number,
  input: { businessDate: string; locationId: number | null; countedCashCents: number; notes: string | null },
  actor: Actor,
) {
  if (input.businessDate > today()) throw new UserError("You can't close a day that hasn't happened yet.");
  const pays = await dayPayments(tenantId, input.businessDate);
  const d = dayTotals(pays.map((p) => ({ method: p.method, amountCents: p.amountCents })));
  const diff = overShort(input.countedCashCents, d.expectedCashCents);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(registerCloses)
      .values({
        tenantId,
        locationId: input.locationId,
        businessDate: input.businessDate,
        expectedCashCents: d.expectedCashCents,
        countedCashCents: input.countedCashCents,
        totals: d.totals,
        notes: input.notes,
        closedBy: actor.id,
      })
      .returning();
    await logActivity(
      {
        tenantId,
        action: "register.closed",
        entityType: "payment",
        actorId: actor.id,
        summary: `Closed the register for ${fmtDate(input.businessDate, { year: true })}: counted ${money(input.countedCashCents)} cash, expected ${money(d.expectedCashCents)} (${overShortLabel(diff, money)})`,
        data: { registerCloseId: row!.id, totals: d.totals, overShortCents: diff },
      },
      tx,
    );
    return row!;
  });
}

