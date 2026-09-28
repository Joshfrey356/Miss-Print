import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, ne, notExists, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, invoiceItems, invoices, jobs, locations, paymentLinks, payments, quotes, registerCloses, users } from "@/lib/db/schema";
import { parseJobNumber } from "@/lib/format";

/** An invoice with everything the payment screen and the receipt need. */
export async function getCounterSale(tenantId: number, invoiceId: number) {
  const [row] = await db
    .select({
      inv: invoices,
      customer: { id: customers.id, name: customers.name, email: customers.email, phone: customers.phone, taxExempt: customers.taxExempt },
      job: { id: jobs.id, number: jobs.number, title: jobs.title, status: jobs.status },
      createdByName: users.name,
    })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(jobs, eq(jobs.id, invoices.jobId))
    .leftJoin(users, eq(users.id, invoices.createdBy))
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)));
  if (!row) return null;
  const [items, pays, links] = await Promise.all([
    db.select().from(invoiceItems).where(and(eq(invoiceItems.tenantId, tenantId), eq(invoiceItems.invoiceId, invoiceId))).orderBy(asc(invoiceItems.sortOrder), asc(invoiceItems.id)),
    db
      .select({ p: payments, recordedByName: users.name })
      .from(payments)
      .leftJoin(users, eq(users.id, payments.recordedBy))
      .where(and(eq(payments.tenantId, tenantId), eq(payments.invoiceId, invoiceId)))
      .orderBy(asc(payments.createdAt), asc(payments.id)),
    db
      .select()
      .from(paymentLinks)
      .where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.invoiceId, invoiceId)))
      .orderBy(desc(paymentLinks.createdAt))
      .limit(10),
  ]);
  return { ...row, job: row.job?.id ? row.job : null, items, payments: pays, links };
}
export type CounterSale = NonNullable<Awaited<ReturnType<typeof getCounterSale>>>;

/** Non-voided payments received on a business date (the whole shop). */
export async function dayPayments(tenantId: number, ymd: string) {
  return db
    .select({
      id: payments.id,
      invoiceId: payments.invoiceId,
      invoiceNumber: invoices.number,
      invoiceSource: invoices.source,
      customerName: customers.name,
      method: payments.method,
      amountCents: payments.amountCents,
      tenderedCents: payments.tenderedCents,
      reference: payments.reference,
      processorRef: payments.processorRef,
      createdAt: payments.createdAt,
      recordedByName: users.name,
    })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .leftJoin(users, eq(users.id, payments.recordedBy))
    .where(and(eq(payments.tenantId, tenantId), eq(payments.receivedOn, ymd), isNull(payments.voidedAt)))
    .orderBy(desc(payments.createdAt), desc(payments.id));
}

/** Counter sales rung up on a business date. */
export async function daySales(tenantId: number, ymd: string) {
  return db
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      totalCents: invoices.totalCents,
      paidCents: invoices.paidCents,
      createdAt: invoices.createdAt,
      customerName: customers.name,
      jobNumber: jobs.number,
      createdByName: users.name,
    })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(jobs, eq(jobs.id, invoices.jobId))
    .leftJoin(users, eq(users.id, invoices.createdBy))
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.source, "counter"), eq(invoices.issueDate, ymd)))
    .orderBy(desc(invoices.createdAt), desc(invoices.id));
}

const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;

/**
 * "Take a payment": open invoices, jobs that have no invoice yet and quotes waiting on the customer,
 * matched by number, customer or title. Without a search, the most recent of each.
 */
export async function searchPayables(tenantId: number, qRaw: string | undefined) {
  const q = (qRaw ?? "").trim().slice(0, 80);
  const like = likeOf(q);
  const digits = q.replace(/^(inv|mp|q)[-\s]?/i, "");
  const num = /^\d{1,9}$/.test(digits) ? Number(digits) : null;
  const jobNum = q ? parseJobNumber(q) ?? num : null;

  const [openInvoices, uninvoicedJobs, openQuotes] = await Promise.all([
    db
      .select({
        id: invoices.id,
        number: invoices.number,
        status: invoices.status,
        source: invoices.source,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        totalCents: invoices.totalCents,
        paidCents: invoices.paidCents,
        customerName: customers.name,
        jobNumber: jobs.number,
        jobTitle: jobs.title,
      })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .leftJoin(jobs, eq(jobs.id, invoices.jobId))
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          inArray(invoices.status, ["draft", "sent", "partial"]),
          sql`${invoices.totalCents} > ${invoices.paidCents}`,
          q ? or(ilike(customers.name, like), ilike(jobs.title, like), num != null ? eq(invoices.number, num) : undefined, jobNum != null ? eq(jobs.number, jobNum) : undefined) : undefined,
        ),
      )
      .orderBy(desc(invoices.issueDate), desc(invoices.id))
      .limit(q ? 20 : 8),
    db
      .select({ id: jobs.id, number: jobs.number, title: jobs.title, status: jobs.status, totalCents: jobs.totalCents, dueDate: jobs.dueDate, customerName: customers.name })
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .where(
        and(
          eq(jobs.tenantId, tenantId),
          isNull(jobs.archivedAt),
          ne(jobs.status, "cancelled"),
          sql`${jobs.totalCents} > 0`,
          notExists(
            db
              .select({ one: sql`1` })
              .from(invoices)
              .where(and(eq(invoices.tenantId, tenantId), eq(invoices.jobId, jobs.id), ne(invoices.status, "void"))),
          ),
          q ? or(ilike(customers.name, like), ilike(jobs.title, like), jobNum != null ? eq(jobs.number, jobNum) : undefined) : undefined,
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(q ? 20 : 8),
    db
      .select({ id: quotes.id, number: quotes.number, title: quotes.title, status: quotes.status, totalCents: quotes.totalCents, customerName: customers.name })
      .from(quotes)
      .innerJoin(customers, eq(customers.id, quotes.customerId))
      .where(
        and(
          eq(quotes.tenantId, tenantId),
          isNull(quotes.archivedAt),
          inArray(quotes.status, ["sent", "accepted"]),
          sql`${quotes.totalCents} > 0`,
          q ? or(ilike(customers.name, like), ilike(quotes.title, like), num != null ? eq(quotes.number, num) : undefined) : undefined,
        ),
      )
      .orderBy(desc(quotes.updatedAt))
      .limit(q ? 20 : 5),
  ]);
  return { openInvoices, uninvoicedJobs, openQuotes };
}

/** Saved drawer counts, newest first (optionally one day). */
export async function listRegisterCloses(tenantId: number, opts: { date?: string; limit?: number } = {}) {
  return db
    .select({ c: registerCloses, locationName: locations.name, closedByName: users.name })
    .from(registerCloses)
    .leftJoin(locations, eq(locations.id, registerCloses.locationId))
    .leftJoin(users, eq(users.id, registerCloses.closedBy))
    .where(and(eq(registerCloses.tenantId, tenantId), opts.date ? eq(registerCloses.businessDate, opts.date) : undefined))
    .orderBy(desc(registerCloses.businessDate), desc(registerCloses.createdAt))
    .limit(opts.limit ?? 60);
}
