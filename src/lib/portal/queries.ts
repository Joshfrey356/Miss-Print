import "server-only";
import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { files, invoiceItems, invoices, jobItems, jobStatusHistory, jobs, payments, portalRequests, proofs, quoteItems, quotes } from "@/lib/db/schema";
import { balanceOf } from "@/lib/money/service";
import { today } from "@/lib/format";
import type { StoredBreakdown } from "@/lib/quotes/print-options";
import { PORTAL_INVOICE_STATUSES, PORTAL_PROOF_STATUSES, PORTAL_QUOTE_STATUSES, quoteAnswerable } from "./rules";
import type { PortalSession } from "./session";

/**
 * Everything the customer portal reads. Every query is scoped to the session's shop AND customer, and
 * selects only customer-safe columns: no costs, margins, internal notes, staff names or activity.
 */
type S = Pick<PortalSession, "tenantId" | "customerId">;

const jobCols = {
  id: jobs.id,
  number: jobs.number,
  title: jobs.title,
  status: jobs.status,
  fulfillment: jobs.fulfillment,
  dueDate: jobs.dueDate,
  fulfillmentAt: jobs.fulfillmentAt,
  poNumber: jobs.poNumber,
  needsDesign: jobs.needsDesign,
  needsProof: jobs.needsProof,
  customerNotes: jobs.customerNotes,
  createdAt: jobs.createdAt,
  completedAt: jobs.completedAt,
};
const mine = (tenantId: number, customerId: number) => and(eq(jobs.tenantId, tenantId), eq(jobs.customerId, customerId), isNull(jobs.archivedAt));

export async function portalJobs(s: S, which: "open" | "past", limit = 100) {
  return db
    .select(jobCols)
    .from(jobs)
    .where(and(mine(s.tenantId, s.customerId), which === "open" ? notInArray(jobs.status, ["completed", "cancelled"]) : inArray(jobs.status, ["completed"])))
    .orderBy(which === "open" ? sql`${jobs.dueDate} asc nulls last` : desc(sql`coalesce(${jobs.completedAt}, ${jobs.createdAt})`), desc(jobs.number))
    .limit(limit);
}
export type PortalJobRow = Awaited<ReturnType<typeof portalJobs>>[number];

/** Proofs sent to this customer that still need an answer. */
export async function proofsWaiting(s: S) {
  return db
    .select({ id: proofs.id, version: proofs.version, sentAt: proofs.sentAt, jobNumber: jobs.number, jobTitle: jobs.title })
    .from(proofs)
    .innerJoin(jobs, and(eq(jobs.tenantId, proofs.tenantId), eq(jobs.id, proofs.jobId)))
    .where(and(eq(proofs.tenantId, s.tenantId), eq(jobs.customerId, s.customerId), isNull(jobs.archivedAt), eq(proofs.status, "sent")))
    .orderBy(desc(proofs.sentAt));
}

export async function portalQuotes(s: S) {
  const rows = await db
    .select({ id: quotes.id, number: quotes.number, title: quotes.title, status: quotes.status, totalCents: quotes.totalCents, validUntil: quotes.validUntil, sentAt: quotes.sentAt, respondedAt: quotes.respondedAt })
    .from(quotes)
    .where(and(eq(quotes.tenantId, s.tenantId), eq(quotes.customerId, s.customerId), isNull(quotes.archivedAt), inArray(quotes.status, PORTAL_QUOTE_STATUSES)))
    .orderBy(desc(quotes.sentAt), desc(quotes.number))
    .limit(100);
  const now = today();
  return rows.map((q) => ({ ...q, canAnswer: quoteAnswerable(q, now).ok, expired: q.status === "expired" || (q.status === "sent" && !!q.validUntil && q.validUntil < now) }));
}
export type PortalQuoteRow = Awaited<ReturnType<typeof portalQuotes>>[number];

export async function portalQuote(s: S, id: number) {
  const [q] = await db
    .select({
      id: quotes.id,
      number: quotes.number,
      title: quotes.title,
      status: quotes.status,
      dueDate: quotes.dueDate,
      validUntil: quotes.validUntil,
      subtotalCents: quotes.subtotalCents,
      taxCents: quotes.taxCents,
      totalCents: quotes.totalCents,
      customerNotes: quotes.customerNotes,
      sentAt: quotes.sentAt,
      respondedAt: quotes.respondedAt,
      lostReason: quotes.lostReason,
      responseName: quotes.responseName,
      responseNote: quotes.responseNote,
      archivedAt: quotes.archivedAt,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .where(and(eq(quotes.tenantId, s.tenantId), eq(quotes.customerId, s.customerId), eq(quotes.id, id), isNull(quotes.archivedAt), inArray(quotes.status, PORTAL_QUOTE_STATUSES)));
  if (!q) return null;
  const items = await db
    .select({ id: quoteItems.id, description: quoteItems.description, quantity: quoteItems.quantity, widthIn: quoteItems.widthIn, heightIn: quoteItems.heightIn, material: quoteItems.material, colors: quoteItems.colors, finishing: quoteItems.finishing, specs: quoteItems.specs, priceCents: quoteItems.priceCents, breakdown: quoteItems.pricingBreakdown })
    .from(quoteItems)
    .where(and(eq(quoteItems.tenantId, s.tenantId), eq(quoteItems.quoteId, q.id)))
    .orderBy(asc(quoteItems.sortOrder));
  const [job] = q.status === "converted" ? await db.select({ number: jobs.number }).from(jobs).where(and(mine(s.tenantId, s.customerId), eq(jobs.quoteId, q.id))).limit(1) : [];
  return {
    quote: q,
    // Only the extra quantities leave the server — never the cost lines of the price breakdown.
    items: items.map(({ breakdown, ...i }) => ({ ...i, options: ((breakdown as StoredBreakdown | null)?.quantityOptions ?? []).map((o) => ({ quantity: o.quantity, recommendedCents: o.recommendedCents })) })),
    jobNumber: job?.number ?? null,
  };
}
export type PortalQuoteDetail = NonNullable<Awaited<ReturnType<typeof portalQuote>>>;

export async function portalInvoices(s: S) {
  const rows = await db
    .select({ id: invoices.id, number: invoices.number, status: invoices.status, issueDate: invoices.issueDate, dueDate: invoices.dueDate, totalCents: invoices.totalCents, paidCents: invoices.paidCents, jobNumber: jobs.number, jobTitle: jobs.title })
    .from(invoices)
    .leftJoin(jobs, and(eq(jobs.tenantId, invoices.tenantId), eq(jobs.id, invoices.jobId)))
    .where(and(eq(invoices.tenantId, s.tenantId), eq(invoices.customerId, s.customerId), inArray(invoices.status, PORTAL_INVOICE_STATUSES)))
    .orderBy(desc(invoices.issueDate), desc(invoices.number))
    .limit(200);
  return rows.map((r) => ({ ...r, balanceCents: balanceOf(r) }));
}
export type PortalInvoiceRow = Awaited<ReturnType<typeof portalInvoices>>[number];

export async function portalInvoice(s: S, id: number) {
  const [inv] = await db
    .select({ id: invoices.id, number: invoices.number, status: invoices.status, issueDate: invoices.issueDate, dueDate: invoices.dueDate, poNumber: invoices.poNumber, subtotalCents: invoices.subtotalCents, taxRate: invoices.taxRate, taxCents: invoices.taxCents, totalCents: invoices.totalCents, paidCents: invoices.paidCents, jobNumber: jobs.number, jobTitle: jobs.title })
    .from(invoices)
    .leftJoin(jobs, and(eq(jobs.tenantId, invoices.tenantId), eq(jobs.id, invoices.jobId)))
    .where(and(eq(invoices.tenantId, s.tenantId), eq(invoices.customerId, s.customerId), eq(invoices.id, id), inArray(invoices.status, PORTAL_INVOICE_STATUSES)));
  if (!inv) return null;
  const [items, paid] = await Promise.all([
    db
      .select({ id: invoiceItems.id, description: invoiceItems.description, quantity: invoiceItems.quantity, amountCents: invoiceItems.amountCents })
      .from(invoiceItems)
      .where(and(eq(invoiceItems.tenantId, s.tenantId), eq(invoiceItems.invoiceId, inv.id)))
      .orderBy(asc(invoiceItems.sortOrder)),
    db
      .select({ id: payments.id, amountCents: payments.amountCents, method: payments.method, receivedOn: payments.receivedOn })
      .from(payments)
      .where(and(eq(payments.tenantId, s.tenantId), eq(payments.invoiceId, inv.id), isNull(payments.voidedAt)))
      .orderBy(asc(payments.receivedOn)),
  ]);
  return { inv: { ...inv, balanceCents: balanceOf(inv) }, items, payments: paid };
}

/** One job, by its number, only if it belongs to this customer. */
export async function portalJob(s: S, number: number) {
  const [job] = await db.select(jobCols).from(jobs).where(and(mine(s.tenantId, s.customerId), eq(jobs.number, number)));
  if (!job) return null;
  const [items, history, proofRows, fileRows, invoiceRows] = await Promise.all([
    db
      .select({ id: jobItems.id, description: jobItems.description, quantity: jobItems.quantity, widthIn: jobItems.widthIn, heightIn: jobItems.heightIn, material: jobItems.material, colors: jobItems.colors, finishing: jobItems.finishing, specs: jobItems.specs })
      .from(jobItems)
      .where(and(eq(jobItems.tenantId, s.tenantId), eq(jobItems.jobId, job.id)))
      .orderBy(asc(jobItems.sortOrder)),
    db
      .select({ toStatus: jobStatusHistory.toStatus, changedAt: jobStatusHistory.changedAt })
      .from(jobStatusHistory)
      .where(and(eq(jobStatusHistory.tenantId, s.tenantId), eq(jobStatusHistory.jobId, job.id)))
      .orderBy(asc(jobStatusHistory.changedAt)),
    db
      .select({ id: proofs.id, version: proofs.version, status: proofs.status, note: proofs.note, sentAt: proofs.sentAt, respondedAt: proofs.respondedAt, responderName: proofs.responderName, customerComment: proofs.customerComment, fileId: proofs.fileId, mimeType: files.mimeType, filename: files.filename })
      .from(proofs)
      .innerJoin(files, and(eq(files.tenantId, proofs.tenantId), eq(files.id, proofs.fileId)))
      .where(and(eq(proofs.tenantId, s.tenantId), eq(proofs.jobId, job.id), inArray(proofs.status, [...PORTAL_PROOF_STATUSES])))
      .orderBy(desc(proofs.version)),
    db
      .select({ id: files.id, filename: files.filename, mimeType: files.mimeType, sizeBytes: files.sizeBytes, createdAt: files.createdAt })
      .from(files)
      .where(and(eq(files.tenantId, s.tenantId), eq(files.jobId, job.id), eq(files.uploadedByCustomer, true), isNull(files.archivedAt)))
      .orderBy(desc(files.createdAt)),
    db
      .select({ id: invoices.id, number: invoices.number, status: invoices.status, totalCents: invoices.totalCents, paidCents: invoices.paidCents, dueDate: invoices.dueDate })
      .from(invoices)
      .where(and(eq(invoices.tenantId, s.tenantId), eq(invoices.customerId, s.customerId), eq(invoices.jobId, job.id), inArray(invoices.status, PORTAL_INVOICE_STATUSES))),
  ]);
  return { job, items, history, proofs: proofRows, files: fileRows, invoices: invoiceRows.map((i) => ({ ...i, balanceCents: balanceOf(i) })) };
}
export type PortalJobDetail = NonNullable<Awaited<ReturnType<typeof portalJob>>>;

/** A single-line quantity for "Reorder" (null when the job has several lines). */
export async function reorderDefaults(s: S, jobId: number) {
  const items = await db
    .select({ description: jobItems.description, quantity: jobItems.quantity })
    .from(jobItems)
    .innerJoin(jobs, and(eq(jobs.tenantId, jobItems.tenantId), eq(jobs.id, jobItems.jobId)))
    .where(and(eq(jobItems.tenantId, s.tenantId), eq(jobItems.jobId, jobId), eq(jobs.customerId, s.customerId)));
  return { items, quantity: items.length === 1 ? items[0]!.quantity : null };
}

export async function portalRequestsFor(s: S, limit = 5) {
  return db
    .select({ id: portalRequests.id, kind: portalRequests.kind, subject: portalRequests.subject, status: portalRequests.status, createdAt: portalRequests.createdAt, resultJobNumber: jobs.number })
    .from(portalRequests)
    .leftJoin(jobs, and(eq(jobs.tenantId, portalRequests.tenantId), eq(jobs.id, portalRequests.resultJobId)))
    .where(and(eq(portalRequests.tenantId, s.tenantId), eq(portalRequests.customerId, s.customerId)))
    .orderBy(desc(portalRequests.createdAt))
    .limit(limit);
}

/**
 * A file the customer may open: one they uploaded, or a proof that was sent to them — and only
 * from their own jobs / account.
 */
export async function portalFile(s: S, id: number) {
  const [f] = await db
    .select({ id: files.id, filename: files.filename, mimeType: files.mimeType, storageKey: files.storageKey, uploadedByCustomer: files.uploadedByCustomer, folder: files.folder, jobId: files.jobId, customerId: files.customerId, jobCustomerId: jobs.customerId })
    .from(files)
    .leftJoin(jobs, and(eq(jobs.tenantId, files.tenantId), eq(jobs.id, files.jobId)))
    .where(and(eq(files.tenantId, s.tenantId), eq(files.id, id), isNull(files.archivedAt), or(eq(files.customerId, s.customerId), eq(jobs.customerId, s.customerId))));
  if (!f) return null;
  if (f.jobId && f.jobCustomerId !== s.customerId) return null;
  if (f.uploadedByCustomer) return f;
  if (f.folder !== "proof") return null;
  const [p] = await db
    .select({ id: proofs.id })
    .from(proofs)
    .where(and(eq(proofs.tenantId, s.tenantId), eq(proofs.fileId, f.id), inArray(proofs.status, [...PORTAL_PROOF_STATUSES])))
    .limit(1);
  return p ? f : null;
}

/** Counts for the portal's home page badges. */
export async function portalCounts(s: S) {
  const [[q], [p], [i]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(quotes)
      .where(and(eq(quotes.tenantId, s.tenantId), eq(quotes.customerId, s.customerId), isNull(quotes.archivedAt), eq(quotes.status, "sent"), sql`(${quotes.validUntil} is null or ${quotes.validUntil} >= ${today()})`)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(proofs)
      .innerJoin(jobs, and(eq(jobs.tenantId, proofs.tenantId), eq(jobs.id, proofs.jobId)))
      .where(and(eq(proofs.tenantId, s.tenantId), eq(jobs.customerId, s.customerId), isNull(jobs.archivedAt), eq(proofs.status, "sent"))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(invoices)
      .where(and(eq(invoices.tenantId, s.tenantId), eq(invoices.customerId, s.customerId), inArray(invoices.status, ["sent", "partial"]))),
  ]);
  return { quotes: q?.n ?? 0, proofs: p?.n ?? 0, invoices: i?.n ?? 0 };
}
