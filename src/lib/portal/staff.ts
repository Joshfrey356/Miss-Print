import "server-only";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerContacts, customers, files, jobItems, jobs, portalRequests, quotes, users } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { UserError } from "@/lib/actions";
import { changeJobStatus, reorderJob, type Actor } from "@/lib/jobs/service";
import { nextStatus } from "@/lib/jobs/workflow";
import { jobNo, quoteNo } from "@/lib/format";
import { getJobPrefix } from "@/lib/tenant";
import { requestDetails, REQUEST_KIND_LABELS } from "./rules";

/** Staff inbox for customer portal requests. Everything is scoped to the staff member's shop. */

export type RequestTab = "new" | "handled";

export async function getPortalRequestCounts(tenantId: number): Promise<{ new: number; handled: number }> {
  const rows = await db
    .select({ status: portalRequests.status, n: sql<number>`count(*)::int` })
    .from(portalRequests)
    .where(eq(portalRequests.tenantId, tenantId))
    .groupBy(portalRequests.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  return { new: by.new ?? 0, handled: by.handled ?? 0 };
}

export async function listPortalRequests(tenantId: number, tab: RequestTab, limit = 100) {
  return db
    .select({
      id: portalRequests.id,
      kind: portalRequests.kind,
      subject: portalRequests.subject,
      body: portalRequests.body,
      status: portalRequests.status,
      createdAt: portalRequests.createdAt,
      handledAt: portalRequests.handledAt,
      fromName: portalRequests.fromName,
      customerId: portalRequests.customerId,
      customerName: customers.name,
      jobNumber: jobs.number,
    })
    .from(portalRequests)
    .innerJoin(customers, and(eq(customers.tenantId, portalRequests.tenantId), eq(customers.id, portalRequests.customerId)))
    .leftJoin(jobs, and(eq(jobs.tenantId, portalRequests.tenantId), eq(jobs.id, portalRequests.jobId)))
    .where(and(eq(portalRequests.tenantId, tenantId), eq(portalRequests.status, tab)))
    .orderBy(tab === "new" ? portalRequests.createdAt : desc(portalRequests.handledAt))
    .limit(limit);
}
export type PortalRequestRow = Awaited<ReturnType<typeof listPortalRequests>>[number];

export async function getPortalRequest(tenantId: number, id: number) {
  const [r] = await db
    .select({ req: portalRequests, customerName: customers.name, customerPhone: customers.phone, customerEmail: customers.email, contactName: customerContacts.name, contactPhone: customerContacts.phone })
    .from(portalRequests)
    .innerJoin(customers, and(eq(customers.tenantId, portalRequests.tenantId), eq(customers.id, portalRequests.customerId)))
    .leftJoin(customerContacts, and(eq(customerContacts.tenantId, portalRequests.tenantId), eq(customerContacts.id, portalRequests.contactId)))
    .where(and(eq(portalRequests.tenantId, tenantId), eq(portalRequests.id, id)));
  if (!r) return null;
  const d = requestDetails(r.req.details);
  const jobIds = [r.req.jobId, r.req.resultJobId].filter((x): x is number => typeof x === "number");
  const [jobRows, fileRows, quoteRows, handler, recentQuotes, items] = await Promise.all([
    jobIds.length ? db.select({ id: jobs.id, number: jobs.number, title: jobs.title, status: jobs.status, dueDate: jobs.dueDate }).from(jobs).where(and(eq(jobs.tenantId, tenantId), inArray(jobs.id, jobIds))) : [],
    d.fileIds.length
      ? db.select({ id: files.id, filename: files.filename, sizeBytes: files.sizeBytes, jobId: files.jobId }).from(files).where(and(eq(files.tenantId, tenantId), eq(files.customerId, r.req.customerId), inArray(files.id, d.fileIds)))
      : [],
    r.req.quoteId ? db.select({ id: quotes.id, number: quotes.number, title: quotes.title, status: quotes.status }).from(quotes).where(and(eq(quotes.tenantId, tenantId), eq(quotes.id, r.req.quoteId))) : [],
    r.req.handledBy ? db.select({ name: users.name }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, r.req.handledBy))) : [],
    // Quotes for this customer made since the request came in — to link one when marking it handled.
    db
      .select({ id: quotes.id, number: quotes.number, title: quotes.title })
      .from(quotes)
      .where(and(eq(quotes.tenantId, tenantId), eq(quotes.customerId, r.req.customerId), isNull(quotes.archivedAt), gte(quotes.createdAt, r.req.createdAt)))
      .orderBy(desc(quotes.createdAt))
      .limit(10),
    r.req.jobId ? db.select({ description: jobItems.description, quantity: jobItems.quantity }).from(jobItems).where(and(eq(jobItems.tenantId, tenantId), eq(jobItems.jobId, r.req.jobId))) : [],
  ]);
  return {
    ...r,
    details: d,
    job: jobRows.find((j) => j.id === r.req.jobId) ?? null,
    resultJob: jobRows.find((j) => j.id === r.req.resultJobId) ?? null,
    files: fileRows,
    quote: quoteRows[0] ?? null,
    handledByName: handler[0]?.name ?? null,
    recentQuotes,
    sourceItems: items,
  };
}
export type PortalRequestDetail = NonNullable<Awaited<ReturnType<typeof getPortalRequest>>>;

async function loadRequest(tenantId: number, id: number) {
  const [r] = await db.select().from(portalRequests).where(and(eq(portalRequests.tenantId, tenantId), eq(portalRequests.id, id)));
  if (!r) throw new UserError("Request not found.");
  return r;
}

/** Mark a request handled, optionally noting the quote or job that came of it. */
export async function markRequestHandled(tenantId: number, id: number, link: { quoteId?: number | null; jobNumber?: number | null }, actor: Actor) {
  const r = await loadRequest(tenantId, id);
  let quoteId: number | null = r.quoteId;
  let resultJobId: number | null = r.resultJobId;
  const notes: string[] = [];
  if (link.quoteId) {
    const [q] = await db.select({ id: quotes.id, number: quotes.number }).from(quotes).where(and(eq(quotes.tenantId, tenantId), eq(quotes.customerId, r.customerId), eq(quotes.id, link.quoteId)));
    if (!q) throw new UserError("That quote isn't for this customer.");
    quoteId = q.id;
    notes.push(quoteNo(q.number));
  }
  if (link.jobNumber) {
    const [j] = await db.select({ id: jobs.id, number: jobs.number }).from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.customerId, r.customerId), eq(jobs.number, link.jobNumber)));
    if (!j) throw new UserError("That job isn't for this customer.");
    resultJobId = j.id;
    notes.push(jobNo(j.number, await getJobPrefix(tenantId)));
  }
  await db.transaction(async (tx) => {
    await tx.update(portalRequests).set({ status: "handled", quoteId, resultJobId, handledBy: actor.id, handledAt: new Date() }).where(and(eq(portalRequests.tenantId, tenantId), eq(portalRequests.id, id)));
    await logActivity({ tenantId, action: "portal.request_handled", entityType: "customer", entityId: r.id, customerId: r.customerId, jobId: resultJobId ?? r.jobId, quoteId, actorId: actor.id, summary: `Handled the customer's ${REQUEST_KIND_LABELS[r.kind].toLowerCase()} “${r.subject.slice(0, 100)}”${notes.length ? ` → ${notes.join(", ")}` : ""}`, data: { before: { status: r.status }, after: { status: "handled" } } }, tx);
  });
}

export async function reopenRequest(tenantId: number, id: number, actor: Actor) {
  const r = await loadRequest(tenantId, id);
  await db.transaction(async (tx) => {
    await tx.update(portalRequests).set({ status: "new", handledBy: null, handledAt: null }).where(and(eq(portalRequests.tenantId, tenantId), eq(portalRequests.id, id)));
    await logActivity({ tenantId, action: "portal.request_reopened", entityType: "customer", entityId: r.id, customerId: r.customerId, actorId: actor.id, summary: `Moved the customer's request “${r.subject.slice(0, 100)}” back to new`, data: { before: { status: r.status }, after: { status: "new" } } }, tx);
  });
}

export type ReorderFromRequest = { quantity: number | null; dueDate: string | null; notes: string | null; sameArtwork: boolean; sameSpecs: boolean };

/**
 * "Create the reorder": copies the original job with reorderJob() (same specs, artwork, price per the
 * usual reorder rules), attaches the files the customer sent, and marks the request handled.
 */
export async function createReorderFromRequest(tenantId: number, id: number, opts: ReorderFromRequest, actor: Actor): Promise<{ number: number }> {
  const r = await loadRequest(tenantId, id);
  if (r.kind !== "reorder" || !r.jobId) throw new UserError("This request isn't a reorder.");
  if (r.resultJobId) throw new UserError("The reorder was already created.");
  const [src] = await db.select({ id: jobs.id, customerId: jobs.customerId }).from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, r.jobId)));
  if (!src || src.customerId !== r.customerId) throw new UserError("The original job wasn't found.");
  const d = requestDetails(r.details);
  const note = [`Customer reorder from the portal (${r.fromName ?? "customer"}${r.fromEmail ? `, ${r.fromEmail}` : ""}).`, opts.notes].filter(Boolean).join("\n");
  const job = await reorderJob(
    src.id,
    { sameQuantity: !opts.quantity, quantity: opts.quantity ?? undefined, sameArtwork: opts.sameArtwork, sameSpecs: opts.sameSpecs, dueDate: opts.dueDate, notes: note },
    actor,
  );
  const [created] = await db.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.number, job.number)));
  await db.transaction(async (tx) => {
    const attached = d.fileIds.length
      ? await tx
          .update(files)
          .set({ jobId: created!.id })
          .where(and(eq(files.tenantId, tenantId), eq(files.customerId, r.customerId), eq(files.uploadedByCustomer, true), inArray(files.id, d.fileIds), isNull(files.jobId)))
          .returning({ id: files.id })
      : [];
    // New artwork came with the request: the job isn't waiting for it.
    if (attached.length && created!.status === "waiting_artwork") {
      const next = nextStatus(created!);
      if (next) await changeJobStatus(tx, created!, next, actor, { reason: "Artwork received with the portal request" });
    }
    await tx.update(portalRequests).set({ status: "handled", resultJobId: created!.id, handledBy: actor.id, handledAt: new Date() }).where(and(eq(portalRequests.tenantId, tenantId), eq(portalRequests.id, id)));
    await logActivity({ tenantId, action: "portal.request_handled", entityType: "customer", entityId: r.id, customerId: r.customerId, jobId: created!.id, actorId: actor.id, summary: `Created reorder ${jobNo(job.number, await getJobPrefix(tenantId))} from the customer's portal request`, data: { before: { status: r.status }, after: { status: "handled" } } }, tx);
  });
  return job;
}
