import "server-only";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { communications, customers, files, jobs, portalRequests, quoteItems, quotes, roleEnum, users } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notifications";
import { can } from "@/lib/permissions";
import { UserError } from "@/lib/actions";
import { changeJobStatus } from "@/lib/jobs/service";
import { nextStatus } from "@/lib/jobs/workflow";
import { jobNo, money, quoteNo, today } from "@/lib/format";
import { getJobPrefix } from "@/lib/tenant";
import { basicPreflight, MAX_UPLOAD_BYTES, newStorageKey, storage } from "@/lib/storage";
import type { StoredBreakdown } from "@/lib/quotes/print-options";
import { checkQuantityChoices, describeRequest, quoteAnswerable, REQUEST_KIND_LABELS, type AcceptQuoteInput, type PortalRequestInput } from "./rules";
import type { PortalSession } from "./session";

type Meta = { ip: string | null; userAgent: string | null };
const who = (s: PortalSession) => (s.name && s.name !== s.customerName ? `${s.name} (${s.customerName})` : s.customerName);

/** Staff to tell about something a customer did: the customer's salesperson + everyone who runs the shop (dashboard.company). */
export async function portalStaffRecipients(tenantId: number, customerId: number, extra: (number | null | undefined)[] = []) {
  const leadRoles = roleEnum.enumValues.filter((r) => can(r, "dashboard.company"));
  const [cust] = await db.select({ salespersonId: customers.salespersonId }).from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
  const leads = await db.select({ id: users.id }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.active, true), inArray(users.role, leadRoles)));
  return [cust?.salespersonId, ...extra, ...leads.map((u) => u.id)];
}

// ---------------------------------------------------------------------------
// Artwork uploads from the portal
// ---------------------------------------------------------------------------
// Same rules as staff uploads (src/lib/files.ts).
const BLOCKED_EXT = /\.(exe|bat|cmd|com|msi|sh|ps1|js|mjs|jar|app|dll|scr|vbs|html?)$/i;
export const MAX_PORTAL_FILES = 20;

/**
 * Save a file a customer uploaded in the portal: same size/type rules as staff uploads (50 MB, no
 * programs or web pages), stored in the job's "Customer Files" (or on the customer when it's for a
 * request), marked uploadedByCustomer. On a job: logs it, moves a job that was waiting for artwork
 * along, and tells the designer and salesperson.
 */
export async function savePortalUpload(file: File, s: PortalSession, opts: { jobId: number | null }) {
  if (file.size > MAX_UPLOAD_BYTES) throw new UserError(`${file.name} is larger than 50 MB.`);
  if (file.size === 0) throw new UserError(`${file.name} is empty.`);
  if (BLOCKED_EXT.test(file.name)) throw new UserError(`${file.name}: this file type isn't allowed.`);
  const filename = file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200) || "file";
  const tenantId = s.tenantId;
  let job: typeof jobs.$inferSelect | undefined;
  if (opts.jobId) {
    [job] = await db.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.customerId, s.customerId), eq(jobs.id, opts.jobId), isNull(jobs.archivedAt)));
    if (!job) throw new UserError("Order not found.");
    if (job.status === "completed" || job.status === "cancelled") throw new UserError("This order is closed. To send files for a new order, use Reorder or Request a quote.");
  }
  const key = newStorageKey(tenantId, filename);
  const mime = file.type || "application/octet-stream";
  await storage().put(key, Buffer.from(await file.arrayBuffer()), mime);
  const pf = basicPreflight(filename, mime, file.size);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(files)
      .values({
        tenantId,
        jobId: job?.id ?? null,
        customerId: s.customerId,
        folder: "customer",
        filename,
        storageKey: key,
        mimeType: mime,
        sizeBytes: file.size,
        preflightStatus: pf.status,
        preflight: { notes: pf.notes },
        uploadedBy: null,
        uploadedByCustomer: true,
      })
      .returning({ id: files.id, filename: files.filename });
    if (job) {
      const label = jobNo(job.number, await getJobPrefix(tenantId));
      await logActivity({ tenantId, action: "file.uploaded", entityType: "file", entityId: row!.id, jobId: job.id, customerId: job.customerId, actorId: null, summary: `Uploaded ${filename} in the customer portal — ${who(s)}`, data: { via: "portal", email: s.email } }, tx);
      if (job.status === "waiting_artwork") {
        const next = nextStatus(job);
        if (next) await changeJobStatus(tx, job, next, null, { reason: "Artwork received from the customer portal" });
      }
      await notify({ tenantId, userIds: [job.designerId, job.salespersonId], kind: "artwork", title: `Customer uploaded artwork to ${label}`, body: `${who(s)}: ${filename}`, link: `/jobs/${job.number}?tab=files` }, tx);
    }
    return row!;
  });
}

/** Files attached to a request must be ones this customer just uploaded in the portal. */
async function checkRequestFiles(tx: Tx, s: PortalSession, ids: number[]) {
  if (!ids.length) return [];
  const rows = await tx
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.tenantId, s.tenantId), eq(files.customerId, s.customerId), eq(files.uploadedByCustomer, true), inArray(files.id, ids), isNull(files.archivedAt), gt(files.createdAt, new Date(Date.now() - 2 * 24 * 3600 * 1000))));
  if (rows.length !== new Set(ids).size) throw new UserError("One of the files couldn't be found. Please upload it again.");
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Requests: reorder, quote request, message
// ---------------------------------------------------------------------------
export async function createPortalRequest(s: PortalSession, input: PortalRequestInput) {
  const tenantId = s.tenantId;
  const prefix = await getJobPrefix(tenantId);
  const id = await db.transaction(async (tx) => {
    const jobId = input.kind === "quote" ? null : input.jobId;
    let job: { id: number; number: number; salespersonId: number | null } | undefined;
    if (jobId) {
      [job] = await tx
        .select({ id: jobs.id, number: jobs.number, salespersonId: jobs.salespersonId })
        .from(jobs)
        .where(and(eq(jobs.tenantId, tenantId), eq(jobs.customerId, s.customerId), eq(jobs.id, jobId), isNull(jobs.archivedAt)));
      if (!job) throw new UserError("Order not found.");
    }
    const fileIds = await checkRequestFiles(tx, s, input.fileIds);
    const d = describeRequest({ ...input, fileIds } as PortalRequestInput, { jobLabel: job ? jobNo(job.number, prefix) : null });
    const [row] = await tx
      .insert(portalRequests)
      .values({ tenantId, customerId: s.customerId, contactId: s.contactId, kind: input.kind, jobId: job?.id ?? null, subject: d.subject.slice(0, 200), body: d.body, details: d.details, fromName: s.name, fromEmail: s.email })
      .returning({ id: portalRequests.id });
    // Files the customer sent with a message about an open order go straight onto that order.
    if (fileIds.length && job && input.kind === "message")
      await tx.update(files).set({ jobId: job.id }).where(and(eq(files.tenantId, tenantId), inArray(files.id, fileIds)));
    await logActivity({ tenantId, action: `portal.${input.kind}_requested`, entityType: "customer", entityId: row!.id, customerId: s.customerId, jobId: job?.id ?? null, actorId: null, summary: `Sent a ${REQUEST_KIND_LABELS[input.kind].toLowerCase()} from the customer portal (${who(s)}): ${d.subject.slice(0, 140)}`, data: { via: "portal", email: s.email, requestId: row!.id } }, tx);
    const recipients = await portalStaffRecipients(tenantId, s.customerId, [job?.salespersonId]);
    await notify({ tenantId, userIds: recipients, kind: "request", title: `${REQUEST_KIND_LABELS[input.kind]} from ${s.customerName}`, body: `${s.name}: ${d.subject.slice(0, 160)}`, link: `/requests/${row!.id}` }, tx);
    return row!.id;
  });
  return { id };
}

// ---------------------------------------------------------------------------
// Quotes: accept / decline online
// ---------------------------------------------------------------------------
async function lockQuote(tx: Tx, s: PortalSession, quoteId: number) {
  const [q] = await tx
    .select()
    .from(quotes)
    .where(and(eq(quotes.tenantId, s.tenantId), eq(quotes.customerId, s.customerId), eq(quotes.id, quoteId)))
    .for("update");
  if (!q) throw new UserError("Quote not found.");
  const check = quoteAnswerable(q, today());
  if (!check.ok) throw new UserError(check.reason);
  return q;
}

/**
 * The customer accepts a quote online: typed name + "I accept", optional note and quantity choices.
 * Marks it accepted with who/where/when (response* columns) and tells the salesperson. It does NOT
 * create the job: staff convert accepted quotes as usual (they may need to set dates, deposits, artwork).
 */
export async function acceptQuoteOnline(s: PortalSession, quoteId: number, input: AcceptQuoteInput, meta: Meta) {
  return db.transaction(async (tx) => {
    const q = await lockQuote(tx, s, quoteId);
    const items = await tx
      .select({ id: quoteItems.id, description: quoteItems.description, quantity: quoteItems.quantity, breakdown: quoteItems.pricingBreakdown })
      .from(quoteItems)
      .where(and(eq(quoteItems.tenantId, s.tenantId), eq(quoteItems.quoteId, q.id)));
    const choice = checkQuantityChoices(
      items.map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, options: (i.breakdown as StoredBreakdown | null)?.quantityOptions })),
      input.quantities,
    );
    if (!choice.ok) throw new UserError(choice.error);
    const note = [choice.lines.length ? `Quantities chosen: ${choice.lines.join("; ")}` : null, input.note || null].filter(Boolean).join("\n") || null;
    await tx
      .update(quotes)
      .set({ status: "accepted", respondedAt: new Date(), lostReason: null, responseName: input.name, responseEmail: s.email, responseIp: meta.ip, responseNote: note, updatedAt: new Date() })
      .where(and(eq(quotes.tenantId, s.tenantId), eq(quotes.id, q.id)));
    await tx.insert(communications).values({ tenantId: s.tenantId, customerId: s.customerId, quoteId: q.id, channel: "note", direction: "inbound", template: "quote_accepted", toAddress: s.email, subject: `Accepted online: ${quoteNo(q.number)}`, body: note, status: "logged" });
    await logActivity(
      {
        tenantId: s.tenantId,
        action: "quote.accepted",
        entityType: "quote",
        entityId: q.id,
        quoteId: q.id,
        customerId: s.customerId,
        actorId: null,
        summary: `Accepted online by ${input.name} (${money(q.totalCents)})${choice.lines.length ? ` — ${choice.lines.join("; ")}` : ""}`,
        data: { before: { status: q.status }, after: { status: "accepted" }, via: "portal", email: s.email, ip: meta.ip, userAgent: meta.userAgent, quantities: input.quantities },
      },
      tx,
    );
    await notify({ tenantId: s.tenantId, userIds: [q.salespersonId, q.createdBy], kind: "quote", title: `${s.customerName} accepted ${quoteNo(q.number)} online`, body: `${input.name}: “${q.title}” — ${money(q.totalCents)}${note ? `\n${note.slice(0, 200)}` : ""}`, link: `/quotes/${q.id}` }, tx);
    return { number: q.number };
  });
}

export async function declineQuoteOnline(s: PortalSession, quoteId: number, reason: string, meta: Meta) {
  return db.transaction(async (tx) => {
    const q = await lockQuote(tx, s, quoteId);
    await tx
      .update(quotes)
      .set({ status: "declined", respondedAt: new Date(), lostReason: reason, responseName: s.name, responseEmail: s.email, responseIp: meta.ip, responseNote: reason, updatedAt: new Date() })
      .where(and(eq(quotes.tenantId, s.tenantId), eq(quotes.id, q.id)));
    await tx.insert(communications).values({ tenantId: s.tenantId, customerId: s.customerId, quoteId: q.id, channel: "note", direction: "inbound", template: "quote_declined", toAddress: s.email, subject: `Declined online: ${quoteNo(q.number)}`, body: reason, status: "logged" });
    await logActivity(
      { tenantId: s.tenantId, action: "quote.declined", entityType: "quote", entityId: q.id, quoteId: q.id, customerId: s.customerId, actorId: null, summary: `Declined online by ${s.name}: ${reason.slice(0, 200)}`, data: { before: { status: q.status }, after: { status: "declined" }, via: "portal", email: s.email, ip: meta.ip } },
      tx,
    );
    await notify({ tenantId: s.tenantId, userIds: [q.salespersonId, q.createdBy], kind: "quote", title: `${s.customerName} declined ${quoteNo(q.number)}`, body: `${s.name}: ${reason.slice(0, 200)}`, link: `/quotes/${q.id}` }, tx);
    return { number: q.number };
  });
}
