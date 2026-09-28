"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { and, eq, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { communications, customerContacts, customers, jobItems, jobStatusHistory, jobs, productCategories, proofs, users, jobStatusEnum, type JobStatus } from "@/lib/db/schema";
import { requirePermission, type SessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { runAction, UserError, str, int, num, bool } from "@/lib/actions";
import { diff, logActivity } from "@/lib/activity";
import { notify } from "@/lib/notifications";
import { changeJobStatus, recalcJobTotals, reorderJob, type ReorderOptions } from "@/lib/jobs/service";
import { BOARD_COLUMNS, STATUS_LABELS, nextStatus } from "@/lib/jobs/workflow";
import { jobNo, money, parseMoney } from "@/lib/format";
import { createInvoiceFromJob } from "@/lib/money/service";
import { emailProvider } from "@/lib/email";
import { getSettings } from "@/lib/settings";
import { nextNumber } from "@/lib/tenant";
import { hashProofToken } from "@/lib/proofs";
import { appUrl } from "@/lib/http";

const actor = (u: SessionUser) => ({ id: u.id, name: u.name, tenantId: u.tenantId });

/** Money / quantity inputs from the client: whole, non-negative, and within the DB's integer range. */
const centsIn = (v: number | null, label: string) => z.number().int().min(0, `${label} can't be negative.`).max(100_000_000, `${label} looks too large.`).parse(v ?? 0);
const qtyIn = (v: number | null) => z.number().int().min(1, "Quantity must be at least 1.").max(10_000_000, "That quantity looks too large.").parse(v ?? 1);

/** A job of the signed-in user's shop; another shop's id is simply "not found". */
async function loadJob(tenantId: number, jobId: number) {
  const [job] = await db.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId)));
  if (!job) throw new UserError("Job not found.");
  return job;
}

/** A contact must belong to the job's customer; otherwise it is dropped. */
async function contactFor(tenantId: number, customerId: number, contactId: number | null) {
  if (!contactId) return null;
  const [c] = await db
    .select({ id: customerContacts.id })
    .from(customerContacts)
    .where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.id, contactId), eq(customerContacts.customerId, customerId)));
  return c ? c.id : null;
}

function revalidateJob(number: number) {
  revalidatePath(`/jobs/${number}`);
  revalidatePath("/jobs");
  revalidatePath("/jobs/board");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
export async function setJobStatus(jobId: number, status: JobStatus, note?: string) {
  return runAction(async () => {
    const user = await requirePermission("jobs.status");
    z.enum(jobStatusEnum.enumValues).parse(status);
    const job = await loadJob(user.tenantId, jobId);
    if ((status === "cancelled" || job.status === "cancelled") && !can(user.role, "jobs.edit")) throw new UserError("Only managers and sales can cancel or restore a job.");
    await db.transaction((tx) => changeJobStatus(tx, job, status, actor(user), { note }));
    revalidateJob(job.number);
    return { status };
  }, `Moved to ${STATUS_LABELS[status]}`);
}

/** The one-click "Next Step" button. */
export async function advanceJob(jobId: number) {
  return runAction(async () => {
    const user = await requirePermission("jobs.status");
    const job = await loadJob(user.tenantId, jobId);
    const next = nextStatus(job);
    if (!next) throw new UserError("This job has no next step.");
    await db.transaction((tx) => changeJobStatus(tx, job, next, actor(user)));
    revalidateJob(job.number);
    return { status: next, label: STATUS_LABELS[next] };
  });
}

/** Drag & drop on the production board. */
export async function moveJobOnBoard(jobId: number, columnKey: string, beforeJobId: number | null) {
  return runAction(async () => {
    const user = await requirePermission("jobs.status");
    const col = BOARD_COLUMNS.find((c) => c.key === columnKey);
    if (!col) throw new UserError("Unknown column.");
    const job = await loadJob(user.tenantId, jobId);
    await db.transaction(async (tx) => {
      if (!col.statuses.includes(job.status)) await changeJobStatus(tx, job, col.dropStatus, actor(user), { reason: "moved on board" });
      // Ordering within a column: place before `beforeJobId` (or at the end).
      let order = 0;
      if (beforeJobId) {
        const [b] = await tx.select({ o: jobs.boardOrder }).from(jobs).where(and(eq(jobs.tenantId, user.tenantId), eq(jobs.id, beforeJobId)));
        order = (b?.o ?? 0) - 1;
      } else {
        const [m] = await tx.select({ o: max(jobs.boardOrder) }).from(jobs).where(eq(jobs.tenantId, user.tenantId));
        order = (m?.o ?? 0) + 1;
      }
      await tx.update(jobs).set({ boardOrder: order }).where(and(eq(jobs.tenantId, user.tenantId), eq(jobs.id, job.id)));
    });
    revalidateJob(job.number);
  });
}

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------
const PRIORITIES = ["normal", "rush", "critical"] as const;
const FULFILLMENTS = ["pickup", "delivery", "install", "ship"] as const;

export async function createJob(_prev: unknown, fd: FormData) {
  const result = await runAction(async () => {
    const user = await requirePermission("jobs.create");
    const customerId = int(fd, "customerId");
    if (!customerId) throw new UserError("Choose a customer.");
    const title = str(fd, "title");
    if (!title) throw new UserError("Give the job a short title, e.g. “4x8 Outdoor Banner”.");
    const tenantId = user.tenantId;
    const [cust] = await db.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
    if (!cust) throw new UserError("Customer not found.");
    const { rules } = await getSettings(tenantId);
    const categoryId = int(fd, "categoryId");
    const [cat] = categoryId ? await db.select().from(productCategories).where(and(eq(productCategories.tenantId, tenantId), eq(productCategories.id, categoryId))) : [];
    if (categoryId && !cat) throw new UserError("Category not found.");
    const needsDesign = bool(fd, "needsDesign");
    const needsProof = bool(fd, "needsProof");
    const needsInstall = bool(fd, "needsInstall");
    const hasArtwork = bool(fd, "hasArtwork");
    const priceCents = can(user.role, "financials.view") ? centsIn(parseMoney(fd.get("price")), "Price") : 0;
    const quantity = qtyIn(int(fd, "quantity"));
    const status: JobStatus = !hasArtwork && !needsDesign ? "waiting_artwork" : needsDesign || needsProof ? "design" : "approved_for_production";
    const fulfillment = z.enum(FULFILLMENTS).catch(needsInstall ? "install" : "pickup").parse(str(fd, "fulfillment") ?? undefined);

    const number = await db.transaction(async (tx) => {
      const [job] = await tx
        .insert(jobs)
        .values({
          tenantId,
          number: await nextNumber(tx, tenantId, "job"),
          customerId,
          contactId: await contactFor(tenantId, customerId, int(fd, "contactId")),
          title,
          categoryId: categoryId ?? null,
          description: str(fd, "description"),
          status,
          priority: z.enum(PRIORITIES).catch("normal").parse(str(fd, "priority") ?? undefined),
          locationId: int(fd, "locationId") ?? cat?.defaultLocationId ?? user.locationId,
          fulfillment,
          needsDesign,
          needsProof,
          needsInstall,
          salespersonId: int(fd, "salespersonId") ?? user.id,
          designerId: int(fd, "designerId"),
          productionId: int(fd, "productionId"),
          installerId: int(fd, "installerId"),
          dueDate: str(fd, "dueDate"),
          poNumber: str(fd, "poNumber"),
          siteAddress: str(fd, "siteAddress"),
          taxRate: cust.taxExempt ? 0 : rules.taxRate,
          internalNotes: str(fd, "internalNotes"),
          createdBy: user.id,
        })
        .returning();
      await tx.insert(jobItems).values({
        tenantId,
        jobId: job!.id,
        categoryId: categoryId ?? null,
        description: str(fd, "itemDescription") ?? title,
        quantity,
        widthIn: num(fd, "widthIn"),
        heightIn: num(fd, "heightIn"),
        material: str(fd, "material"),
        finishing: str(fd, "finishing"),
        specs: str(fd, "specs"),
        priceCents,
        recommendedCents: priceCents,
      });
      await recalcJobTotals(tx, tenantId, job!.id);
      await tx.insert(jobStatusHistory).values({ tenantId, jobId: job!.id, fromStatus: null, toStatus: status, changedBy: user.id, note: "Job created" });
      await logActivity({ tenantId, action: "job.created", entityType: "job", entityId: job!.id, jobId: job!.id, customerId, actorId: user.id, summary: "Created job" }, tx);
      await notify(
        { tenantId, userIds: [job!.designerId, job!.productionId, job!.installerId], kind: "assigned", title: `You're on ${jobNo(job!.number)} ${title}`, link: `/jobs/${job!.number}`, actorId: user.id },
        tx,
      );
      return job!.number;
    });
    revalidatePath("/jobs");
    revalidatePath("/dashboard");
    return { number };
  });
  if (result.ok && result.data) redirect(`/jobs/${result.data.number}`);
  return result;
}

const JobEdit = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().nullable(),
  categoryId: z.number().int().nullable(),
  priority: z.enum(PRIORITIES),
  fulfillment: z.enum(FULFILLMENTS),
  locationId: z.number().int().nullable(),
  contactId: z.number().int().nullable(),
  dueDate: z.string().nullable(),
  productionDueDate: z.string().nullable(),
  fulfillmentAt: z.date().nullable(),
  siteAddress: z.string().nullable(),
  siteContact: z.string().nullable(),
  poNumber: z.string().nullable(),
  needsDesign: z.boolean(),
  needsProof: z.boolean(),
  needsInstall: z.boolean(),
  internalNotes: z.string().nullable(),
  customerNotes: z.string().nullable(),
  laborHours: z.number().min(0).max(1000),
});

export async function updateJob(jobId: number, fd: FormData) {
  return runAction(async () => {
    const user = await requirePermission("jobs.edit");
    const job = await loadJob(user.tenantId, jobId);
    const fa = str(fd, "fulfillmentAt");
    const data = JobEdit.parse({
      title: str(fd, "title") ?? "",
      description: str(fd, "description"),
      categoryId: int(fd, "categoryId"),
      priority: str(fd, "priority") ?? "normal",
      fulfillment: str(fd, "fulfillment") ?? "pickup",
      locationId: int(fd, "locationId"),
      contactId: await contactFor(user.tenantId, job.customerId, int(fd, "contactId")),
      dueDate: str(fd, "dueDate"),
      productionDueDate: str(fd, "productionDueDate"),
      // datetime-local is shop time (Central). Convert with the current offset.
      fulfillmentAt: fa ? new Date(fa + centralOffset(fa)) : null,
      siteAddress: str(fd, "siteAddress"),
      siteContact: str(fd, "siteContact"),
      poNumber: str(fd, "poNumber"),
      needsDesign: bool(fd, "needsDesign"),
      needsProof: bool(fd, "needsProof"),
      needsInstall: bool(fd, "needsInstall"),
      internalNotes: str(fd, "internalNotes"),
      customerNotes: str(fd, "customerNotes"),
      laborHours: num(fd, "laborHours") ?? job.laborHours ?? 0,
    });
    const changes = diff(job as unknown as Record<string, unknown>, data);
    if (!changes) return;
    await db.transaction(async (tx) => {
      await tx.update(jobs).set({ ...data, updatedAt: new Date() }).where(and(eq(jobs.tenantId, user.tenantId), eq(jobs.id, job.id)));
      const fields = Object.keys(changes.after).map((k) => FIELD_LABELS[k] ?? k);
      const dueChanged = "dueDate" in changes.after;
      await logActivity(
        {
          tenantId: user.tenantId,
          action: dueChanged ? "job.due_changed" : "job.updated",
          entityType: "job",
          entityId: jobId,
          jobId,
          customerId: job.customerId,
          actorId: user.id,
          summary: dueChanged ? `Due date changed to ${data.dueDate ?? "none"}` : `Updated ${fields.join(", ")}`,
          data: changes,
        },
        tx,
      );
      if ("fulfillmentAt" in changes.after && job.installerId && data.fulfillment === "install")
        await notify({ tenantId: user.tenantId, userIds: [job.installerId], kind: "assigned", title: `Installation changed for ${jobNo(job.number)}`, body: job.title, link: `/jobs/${job.number}`, actorId: user.id }, tx);
    });
    revalidateJob(job.number);
  }, "Saved");
}

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  description: "description",
  categoryId: "category",
  priority: "priority",
  fulfillment: "pickup/delivery",
  locationId: "location",
  contactId: "contact",
  dueDate: "due date",
  productionDueDate: "production due date",
  fulfillmentAt: "pickup/install time",
  siteAddress: "site address",
  siteContact: "site contact",
  poNumber: "PO number",
  needsDesign: "needs design",
  needsProof: "needs proof",
  needsInstall: "needs installation",
  internalNotes: "internal notes",
  customerNotes: "customer notes",
  laborHours: "labor hours",
};

/** "-05:00" / "-06:00" for America/Chicago on the given local date. */
function centralOffset(localIso: string) {
  const d = new Date(localIso + "Z");
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  const chi = new Date(d.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const mins = Math.round((chi.getTime() - utc.getTime()) / 60000);
  const sign = mins <= 0 ? "-" : "+";
  const a = Math.abs(mins);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

const ASSIGN_FIELDS = { designerId: "Designer", productionId: "Production", installerId: "Installer", salespersonId: "Salesperson" } as const;

export async function assignJob(jobId: number, field: keyof typeof ASSIGN_FIELDS, userId: number | null) {
  return runAction(async () => {
    const user = await requirePermission("jobs.status");
    if (!Object.hasOwn(ASSIGN_FIELDS, field)) throw new UserError("Unknown role.");
    const job = await loadJob(user.tenantId, jobId);
    const [person] = userId ? await db.select({ name: users.name }).from(users).where(and(eq(users.tenantId, user.tenantId), eq(users.id, userId))) : [];
    if (userId && !person) throw new UserError("Person not found.");
    await db.transaction(async (tx) => {
      await tx.update(jobs).set({ [field]: userId, updatedAt: new Date() }).where(and(eq(jobs.tenantId, user.tenantId), eq(jobs.id, job.id)));
      await logActivity(
        {
          tenantId: user.tenantId,
          action: "job.assigned",
          entityType: "job",
          entityId: jobId,
          jobId,
          actorId: user.id,
          summary: person ? `${ASSIGN_FIELDS[field]}: ${person.name}` : `${ASSIGN_FIELDS[field]} unassigned`,
          data: { before: { [field]: job[field] }, after: { [field]: userId } },
        },
        tx,
      );
      if (userId) await notify({ tenantId: user.tenantId, userIds: [userId], kind: "assigned", title: `You're the ${ASSIGN_FIELDS[field].toLowerCase()} on ${jobNo(job.number)}`, body: job.title, link: `/jobs/${job.number}`, actorId: user.id }, tx);
    });
    revalidateJob(job.number);
  }, "Assigned");
}

// ---------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------
export async function saveJobItem(jobId: number, itemId: number | null, fd: FormData) {
  return runAction(async () => {
    const user = await requirePermission("jobs.edit");
    const tenantId = user.tenantId;
    const job = await loadJob(tenantId, jobId);
    const seeMoney = can(user.role, "financials.view");
    const seeCost = can(user.role, "margins.view");
    const description = str(fd, "description");
    if (!description) throw new UserError("Describe the item.");
    const values = {
      description,
      categoryId: int(fd, "categoryId"),
      quantity: qtyIn(int(fd, "quantity")),
      widthIn: num(fd, "widthIn"),
      heightIn: num(fd, "heightIn"),
      material: str(fd, "material"),
      finishing: str(fd, "finishing"),
      colors: str(fd, "colors"),
      specs: str(fd, "specs"),
      taxable: fd.has("taxableField") ? bool(fd, "taxable") : true,
      ...(seeMoney ? { priceCents: centsIn(parseMoney(fd.get("price")), "Price") } : {}),
      ...(seeCost ? { estimatedCostCents: centsIn(parseMoney(fd.get("cost")), "Cost") } : {}),
    };
    await db.transaction(async (tx) => {
      if (itemId) {
        const [before] = await tx.select().from(jobItems).where(and(eq(jobItems.tenantId, tenantId), eq(jobItems.id, itemId), eq(jobItems.jobId, job.id)));
        if (!before) throw new UserError("Item not found.");
        await tx.update(jobItems).set(values).where(and(eq(jobItems.tenantId, tenantId), eq(jobItems.id, itemId)));
        const ch = diff(before as unknown as Record<string, unknown>, values);
        if (ch) {
          const priceChanged = "priceCents" in ch.after;
          await logActivity(
            {
              tenantId,
              action: priceChanged ? "job.price_changed" : "job.item_updated",
              entityType: "job",
              entityId: jobId,
              jobId,
              actorId: user.id,
              summary: priceChanged ? `Price changed ${money(before.priceCents)} → ${money(values.priceCents!)} (${description})` : `Updated item: ${description}`,
              data: ch,
            },
            tx,
          );
        }
      } else {
        const [{ m }] = await tx.select({ m: max(jobItems.sortOrder) }).from(jobItems).where(and(eq(jobItems.tenantId, tenantId), eq(jobItems.jobId, job.id)));
        await tx.insert(jobItems).values({ tenantId, jobId: job.id, ...values, recommendedCents: values.priceCents ?? 0, sortOrder: (m ?? 0) + 1 });
        await logActivity({ tenantId, action: "job.item_added", entityType: "job", entityId: jobId, jobId, actorId: user.id, summary: `Added item: ${description}${seeMoney ? ` (${money(values.priceCents ?? 0)})` : ""}` }, tx);
      }
      await recalcJobTotals(tx, tenantId, job.id);
    });
    revalidateJob(job.number);
  }, "Saved");
}

export async function removeJobItem(jobId: number, itemId: number) {
  return runAction(async () => {
    const user = await requirePermission("jobs.edit");
    const job = await loadJob(user.tenantId, jobId);
    await db.transaction(async (tx) => {
      const [item] = await tx.delete(jobItems).where(and(eq(jobItems.tenantId, user.tenantId), eq(jobItems.id, itemId), eq(jobItems.jobId, job.id))).returning();
      if (!item) throw new UserError("Item not found.");
      await logActivity({ tenantId: user.tenantId, action: "job.item_removed", entityType: "job", entityId: jobId, jobId, actorId: user.id, summary: `Removed item: ${item.description}`, data: { before: item } }, tx);
      await recalcJobTotals(tx, user.tenantId, job.id);
    });
    revalidateJob(job.number);
  }, "Item removed");
}

// ---------------------------------------------------------------------------
// Reorder / archive
// ---------------------------------------------------------------------------
export async function reorderJobAction(jobId: number, opts: ReorderOptions) {
  const result = await runAction(async () => {
    const user = await requirePermission("jobs.create");
    const clean: ReorderOptions = {
      sameQuantity: !!opts.sameQuantity,
      quantity: opts.quantity ? Math.max(1, Math.round(opts.quantity)) : undefined,
      sameArtwork: !!opts.sameArtwork,
      sameSpecs: !!opts.sameSpecs,
      dueDate: opts.dueDate || null,
      priceCents: can(user.role, "financials.view") && opts.priceCents != null ? centsIn(opts.priceCents, "Price") : null,
      notes: opts.notes?.slice(0, 2000) ?? null,
    };
    return reorderJob(jobId, clean, actor(user));
  });
  if (result.ok && result.data) {
    revalidatePath("/jobs");
    redirect(`/jobs/${result.data.number}`);
  }
  return result;
}

export async function archiveJob(jobId: number) {
  return runAction(async () => {
    const user = await requirePermission("jobs.edit");
    const job = await loadJob(user.tenantId, jobId);
    await db.update(jobs).set({ archivedAt: new Date() }).where(and(eq(jobs.tenantId, user.tenantId), eq(jobs.id, job.id)));
    await logActivity({ tenantId: user.tenantId, action: "job.archived", entityType: "job", entityId: jobId, jobId, actorId: user.id, summary: "Archived job" });
    revalidateJob(job.number);
  }, "Job archived");
}

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------
export async function createJobInvoice(jobId: number) {
  return runAction(async () => {
    const user = await requirePermission("money.edit");
    const job = await loadJob(user.tenantId, jobId);
    const inv = await createInvoiceFromJob(user.tenantId, job.id, actor(user));
    revalidateJob(job.number);
    revalidatePath("/money");
    return inv;
  }, "Invoice created");
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------
export async function sendProof(proofId: number, to: string, message: string | null) {
  return runAction(async () => {
    const user = await requirePermission("proofs.send");
    const email = z.string().email("Enter the customer's email address.").parse(to.trim());
    const [proof] = await db.select().from(proofs).where(and(eq(proofs.tenantId, user.tenantId), eq(proofs.id, proofId)));
    if (!proof) throw new UserError("Proof not found.");
    if (proof.status === "approved") throw new UserError("This proof is already approved.");
    if (proof.status === "superseded") throw new UserError("A newer proof version exists. Send that one instead.");
    const job = await loadJob(user.tenantId, proof.jobId);
    const [cust] = await db.select({ name: customers.name }).from(customers).where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, job.customerId)));
    const token = randomBytes(32).toString("base64url");
    const link = `${await appUrl()}/proof/${token}`;
    const { company } = await getSettings(user.tenantId);
    const subject = `Proof ready for approval: ${job.title} (${jobNo(job.number)}) — Proof V${proof.version}`;
    const text = [
      `Hello,`,
      ``,
      `Your proof for "${job.title}" is ready to review.`,
      message ? `\n${message}\n` : ``,
      `Review and approve (or request changes) here — no account needed:`,
      link,
      ``,
      `Please check spelling, phone numbers, colors and sizes carefully. We print exactly what you approve.`,
      ``,
      `Thank you,`,
      `${company.name} · ${company.phone} · ${company.email}`,
    ].join("\n");
    const res = await emailProvider().send({ to: email, subject, text, fromName: company.name, replyTo: company.email || undefined });
    if (!res.ok) throw new UserError("The email could not be sent. Check the email settings.");
    await db.transaction(async (tx) => {
      await tx
        .update(proofs)
        .set({ status: "sent", tokenHash: hashProofToken(token), tokenExpiresAt: new Date(Date.now() + 30 * 86400000), sentAt: new Date(), sentTo: email, sentBy: user.id, note: message ?? proof.note })
        .where(and(eq(proofs.tenantId, user.tenantId), eq(proofs.id, proof.id)));
      await tx.insert(communications).values({ tenantId: user.tenantId, customerId: job.customerId, jobId: job.id, channel: "email", template: "proof_ready", toAddress: email, subject, body: text, status: "sent", providerId: res.providerId, sentBy: user.id });
      await logActivity({ tenantId: user.tenantId, action: "proof.sent", entityType: "proof", entityId: proofId, jobId: job.id, customerId: job.customerId, actorId: user.id, summary: `Sent Proof V${proof.version} to ${email}` }, tx);
      if (job.status !== "waiting_approval") await changeJobStatus(tx, job, "waiting_approval", actor(user), { reason: `Proof V${proof.version} sent` });
    });
    revalidateJob(job.number);
    void cust;
    return { link };
  }, "Proof sent");
}

/** Staff records an approval received in person / by phone. */
export async function recordProofApproval(proofId: number, approverName: string) {
  return runAction(async () => {
    const user = await requirePermission("proofs.send");
    const name = approverName.trim();
    if (!name) throw new UserError("Who approved it?");
    const [proof] = await db.select().from(proofs).where(and(eq(proofs.tenantId, user.tenantId), eq(proofs.id, proofId)));
    if (!proof) throw new UserError("Proof not found.");
    if (proof.status === "approved") throw new UserError("This proof is already approved.");
    if (proof.status === "superseded") throw new UserError("A newer proof version exists. Approve that one instead.");
    const job = await loadJob(user.tenantId, proof.jobId);
    await db.transaction(async (tx) => {
      await tx
        .update(proofs)
        .set({ status: "approved", respondedAt: new Date(), responderName: name, approvalStatement: `Approval recorded by ${user.name} (in person / by phone).` })
        .where(and(eq(proofs.tenantId, user.tenantId), eq(proofs.id, proof.id)));
      await logActivity({ tenantId: user.tenantId, action: "proof.approved", entityType: "proof", entityId: proofId, jobId: job.id, customerId: job.customerId, actorId: user.id, summary: `Proof V${proof.version} approved by ${name} (recorded by ${user.name})` }, tx);
      if (["proof_ready", "waiting_approval", "design"].includes(job.status)) await changeJobStatus(tx, job, "approved_for_production", actor(user), { reason: `Proof V${proof.version} approved` });
    });
    revalidateJob(job.number);
  }, "Proof marked approved");
}

export async function updateContactOnJob(jobId: number, contactId: number | null) {
  return runAction(async () => {
    const user = await requirePermission("jobs.edit");
    const job = await loadJob(user.tenantId, jobId);
    if (contactId && !(await contactFor(user.tenantId, job.customerId, contactId))) throw new UserError("Contact not found.");
    await db.update(jobs).set({ contactId }).where(and(eq(jobs.tenantId, user.tenantId), eq(jobs.id, job.id)));
    revalidateJob(job.number);
  });
}
