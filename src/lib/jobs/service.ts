import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import {
  customers,
  files,
  jobItems,
  jobStatusHistory,
  jobs,
  locations,
  productCategories,
  quoteItems,
  quotes,
  type Job,
  type JobStatus,
} from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notifications";
import { jobNo as fmtJobNo, today } from "@/lib/format";
import { STATUS_LABELS, WORK_STATUSES, afterApproval } from "@/lib/jobs/workflow";
import { taxFor } from "@/lib/pricing/engine";
import { getJobPrefix, nextNumber } from "@/lib/tenant";
import type { ItemPricingRequest } from "@/lib/pricing/server";
import { priceLine, storedBreakdown } from "@/lib/quotes/pricing";
import type { StoredBreakdown } from "@/lib/quotes/print-options";

/** Who is doing it. The shop comes with them: everything they touch belongs to it. */
export type Actor = { id: number; name: string; tenantId: number };

/** Statuses at which the job is handed to the production location of its category. */
const PRODUCTION_HANDOFF: JobStatus[] = ["approved_for_production", "production"];

/**
 * THE one place job status changes. Records history + activity, hands the job
 * to the right location, stamps completion, and notifies the people who need to know.
 */
export async function changeJobStatus(
  tx: Tx,
  job: Pick<Job, "id" | "tenantId" | "number" | "status" | "categoryId" | "locationId" | "designerId" | "productionId" | "installerId" | "salespersonId" | "title">,
  to: JobStatus,
  actor: Actor | null,
  opts: { note?: string; reason?: string } = {},
) {
  if (job.status === to) return;
  // The actor may be null (a customer approving a proof), so the shop always comes from the job.
  const tenantId = job.tenantId;
  const patch: Partial<typeof jobs.$inferInsert> = { status: to, updatedAt: new Date() };

  // Location handoff: e.g. Munster intake → Hammond production for signs.
  if (PRODUCTION_HANDOFF.includes(to) && job.categoryId) {
    const [cat] = await tx
      .select({ loc: productCategories.defaultLocationId })
      .from(productCategories)
      .where(and(eq(productCategories.tenantId, tenantId), eq(productCategories.id, job.categoryId)));
    if (cat?.loc && cat.loc !== job.locationId) {
      patch.locationId = cat.loc;
      const [loc] = await tx.select({ name: locations.name }).from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, cat.loc)));
      await logActivity(
        { tenantId, action: "job.location_changed", entityType: "job", entityId: job.id, jobId: job.id, actorId: actor?.id, summary: `Handed off to ${loc?.name ?? "production"}` },
        tx,
      );
    }
  }
  if (to === "completed") patch.completedAt = new Date();
  else if (job.status === "completed") patch.completedAt = null;

  await tx.update(jobs).set(patch).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, job.id)));
  await tx.insert(jobStatusHistory).values({ tenantId, jobId: job.id, fromStatus: job.status, toStatus: to, changedBy: actor?.id ?? null, note: opts.note ?? null });
  await logActivity(
    {
      tenantId,
      action: "job.status_changed",
      entityType: "job",
      entityId: job.id,
      jobId: job.id,
      actorId: actor?.id,
      summary: `${STATUS_LABELS[job.status]} → ${STATUS_LABELS[to]}${opts.reason ? ` (${opts.reason})` : ""}`,
      data: { before: { status: job.status }, after: { status: to } },
    },
    tx,
  );

  // Tell the next person in line.
  const link = `/jobs/${job.number}`;
  const label = `${fmtJobNo(job.number, await getJobPrefix(tenantId))} ${job.title}`;
  const who =
    to === "design" ? [job.designerId] :
    to === "approved_for_production" ? [job.productionId] :
    to === "scheduled_install" ? [job.installerId] :
    ["ready_pickup", "scheduled_delivery"].includes(to) ? [job.salespersonId] : [];
  if (who.length)
    await notify(
      { tenantId, userIds: who, kind: "assigned", title: `${label} is now ${STATUS_LABELS[to]}`, link, actorId: actor?.id ?? null },
      tx,
    );
}

/** Recalculate job money totals from its line items. */
export async function recalcJobTotals(tx: Tx, tenantId: number, jobId: number) {
  const [row] = await tx
    .select({ taxExempt: customers.taxExempt, taxRate: jobs.taxRate })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId)));
  const items = await tx
    .select({ price: jobItems.priceCents, cost: jobItems.estimatedCostCents, taxable: jobItems.taxable })
    .from(jobItems)
    .where(and(eq(jobItems.tenantId, tenantId), eq(jobItems.jobId, jobId)));
  const subtotal = items.reduce((a, i) => a + i.price, 0);
  const taxable = items.filter((i) => i.taxable).reduce((a, i) => a + i.price, 0);
  const tax = taxFor(taxable, row?.taxRate ?? 0, row?.taxExempt ?? false);
  await tx
    .update(jobs)
    .set({
      subtotalCents: subtotal,
      taxCents: tax,
      totalCents: subtotal + tax,
      estimatedCostCents: items.reduce((a, i) => a + i.cost, 0),
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId)));
}

/** One click: quote → job. Everything carries over; nobody re-types anything. */
export async function convertQuoteToJob(quoteId: number, actor: Actor): Promise<{ number: number }> {
  const tenantId = actor.tenantId;
  const prefix = await getJobPrefix(tenantId);
  const jobNo = (n: number) => fmtJobNo(n, prefix);
  return db.transaction(async (tx) => {
    const [q] = await tx.select().from(quotes).where(and(eq(quotes.tenantId, tenantId), eq(quotes.id, quoteId))).for("update");
    if (!q) throw new Error("Quote not found");
    const existing = await tx.select({ number: jobs.number }).from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.quoteId, q.id))).limit(1);
    if (existing[0]) return existing[0];

    const items = await tx.select().from(quoteItems).where(and(eq(quoteItems.tenantId, tenantId), eq(quoteItems.quoteId, q.id))).orderBy(asc(quoteItems.sortOrder));
    const mainCat = items[0]?.categoryId ?? null;
    const [cat] = mainCat ? await tx.select().from(productCategories).where(and(eq(productCategories.tenantId, tenantId), eq(productCategories.id, mainCat))) : [];
    const quoteFiles = await tx.select({ id: files.id }).from(files).where(and(eq(files.tenantId, tenantId), eq(files.quoteId, q.id)));
    const needsProof = cat?.defaultNeedsProof ?? true;
    const fulfillment = q.needsInstall ? ("install" as const) : ("pickup" as const);
    const start = afterApproval({ status: "approved", needsDesign: q.needsDesign, needsProof, needsInstall: q.needsInstall, fulfillment, hasArtwork: quoteFiles.length > 0 });

    const [job] = await tx
      .insert(jobs)
      .values({
        tenantId,
        number: await nextNumber(tx, tenantId, "job"),
        customerId: q.customerId,
        contactId: q.contactId,
        quoteId: q.id,
        title: q.title,
        categoryId: mainCat,
        description: q.customerNotes,
        status: start,
        priority: q.isRush ? "rush" : "normal",
        locationId: q.locationId ?? cat?.defaultLocationId ?? null,
        fulfillment,
        needsDesign: q.needsDesign,
        needsProof,
        needsInstall: q.needsInstall,
        salespersonId: q.salespersonId,
        dueDate: q.dueDate,
        subtotalCents: q.subtotalCents,
        taxRate: q.taxRate,
        taxCents: q.taxCents,
        totalCents: q.totalCents,
        estimatedCostCents: q.estimatedCostCents,
        internalNotes: q.internalNotes,
        createdBy: actor.id,
      })
      .returning();
    if (items.length)
      await tx.insert(jobItems).values(
        items.map((i) => ({
          tenantId,
          jobId: job!.id,
          categoryId: i.categoryId,
          description: i.description,
          quantity: i.quantity,
          widthIn: i.widthIn,
          heightIn: i.heightIn,
          materialId: i.materialId,
          material: i.material,
          finishing: i.finishing,
          colors: i.colors,
          specs: i.specs,
          pricingInput: i.pricingInput,
          // The estimate travels with the job: how to run it (press, paper, sheets) shows on the ticket.
          pricingBreakdown: i.pricingBreakdown,
          recommendedCents: i.recommendedCents,
          priceCents: i.priceCents,
          overrideReason: i.overrideReason,
          estimatedCostCents: i.estimatedCostCents,
          taxable: i.taxable,
          sortOrder: i.sortOrder,
        })),
      );
    // Quote files move with the job (customer artwork).
    if (quoteFiles.length)
      await tx.update(files).set({ jobId: job!.id }).where(and(eq(files.tenantId, tenantId), inArray(files.id, quoteFiles.map((f) => f.id))));
    await tx.update(quotes).set({ status: "converted", respondedAt: q.respondedAt ?? new Date(), updatedAt: new Date() }).where(and(eq(quotes.tenantId, tenantId), eq(quotes.id, q.id)));
    await tx.insert(jobStatusHistory).values({ tenantId, jobId: job!.id, fromStatus: null, toStatus: start, changedBy: actor.id, note: "Created from quote" });
    await logActivity({ tenantId, action: "job.created", entityType: "job", entityId: job!.id, jobId: job!.id, customerId: q.customerId, quoteId: q.id, actorId: actor.id, summary: `Created from quote Q-${q.number}` }, tx);
    await logActivity({ tenantId, action: "quote.converted", entityType: "quote", entityId: q.id, quoteId: q.id, customerId: q.customerId, jobId: job!.id, actorId: actor.id, summary: `Converted to job ${jobNo(job!.number)}` }, tx);
    return { number: job!.number };
  });
}

export type ReorderOptions = {
  sameQuantity: boolean;
  quantity?: number;
  sameArtwork: boolean;
  sameSpecs: boolean;
  dueDate: string | null;
  priceCents?: number | null; // new total for the (single) line when updated
  notes?: string | null;
};

/** Duplicate a past job as a new one, keeping specs, artwork, materials, price and customer. */
export async function reorderJob(sourceJobId: number, opts: ReorderOptions, actor: Actor): Promise<{ number: number }> {
  const tenantId = actor.tenantId;
  const prefix = await getJobPrefix(tenantId);
  const jobNo = (n: number) => fmtJobNo(n, prefix);
  return db.transaction(async (tx) => {
    const [src] = await tx.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, sourceJobId)));
    if (!src) throw new Error("Job not found");
    const items = await tx.select().from(jobItems).where(and(eq(jobItems.tenantId, tenantId), eq(jobItems.jobId, src.id))).orderBy(asc(jobItems.sortOrder));
    const artwork = opts.sameArtwork
      ? await tx
          .select()
          .from(files)
          .where(and(eq(files.tenantId, tenantId), eq(files.jobId, src.id), inArray(files.folder, ["original_artwork", "production", "working", "customer"]), sql`${files.archivedAt} is null`))
      : [];
    // Same artwork & specs → skip design/proof and go straight to production.
    const straight = opts.sameArtwork && opts.sameSpecs;
    const status: JobStatus = straight ? "approved_for_production" : opts.sameArtwork ? (src.needsProof ? "proof_ready" : "approved_for_production") : "waiting_artwork";

    const [job] = await tx
      .insert(jobs)
      .values({
        tenantId,
        number: await nextNumber(tx, tenantId, "job"),
        customerId: src.customerId,
        contactId: src.contactId,
        reorderOfJobId: src.id,
        title: src.title.startsWith("Reorder") || src.title.startsWith("Repeat") ? src.title : `Reorder: ${src.title}`,
        categoryId: src.categoryId,
        description: src.description,
        status,
        priority: "normal",
        locationId: src.locationId,
        fulfillment: src.fulfillment,
        needsDesign: opts.sameArtwork ? false : src.needsDesign,
        needsProof: straight ? false : src.needsProof,
        needsInstall: src.needsInstall,
        salespersonId: src.salespersonId,
        designerId: src.designerId,
        productionId: src.productionId,
        installerId: src.installerId,
        dueDate: opts.dueDate,
        siteAddress: src.siteAddress,
        taxRate: src.taxRate,
        internalNotes: [opts.notes, `Reorder of ${jobNo(src.number)}.`].filter(Boolean).join("\n"),
        customerNotes: src.customerNotes,
        createdBy: actor.id,
      })
      .returning();

    const qtyFactor = !opts.sameQuantity && opts.quantity && items.length === 1 && items[0]!.quantity > 0 ? opts.quantity / items[0]!.quantity : 1;
    const qtyOf = (i: (typeof items)[number]) => (!opts.sameQuantity && opts.quantity && items.length === 1 ? opts.quantity : i.quantity);
    // Print-estimated lines are re-estimated with today's paper, presses and services (sheets change with
    // the quantity), the same way the reorder dialog's recommended price is worked out.
    const repriced = await Promise.all(
      items.map(async (i) => {
        const { altQuantities: _a, ...input } = (i.pricingInput ?? {}) as Partial<ItemPricingRequest> & { altQuantities?: number[] };
        if (!input.print) return null;
        const req: ItemPricingRequest = { ...input, categoryId: i.categoryId, quantity: qtyOf(i), widthIn: i.widthIn, heightIn: i.heightIn, materialId: i.materialId, customerId: src.customerId, needsDesign: false };
        const p = await priceLine(tenantId, req);
        if (!p.production) return null;
        const { customerId: _c, ...pricingInput } = p.req;
        return { pricingInput, pricingBreakdown: storedBreakdown(p), recommendedCents: p.result.recommendedCents, estimatedCostCents: p.result.estimatedCostCents };
      }),
    );
    if (items.length)
      await tx.insert(jobItems).values(
        items.map((i, idx) => {
          const qty = qtyOf(i);
          const rp = repriced[idx];
          const price =
            idx === 0 && opts.priceCents != null ? opts.priceCents : rp && qty !== i.quantity ? rp.recommendedCents : Math.round(i.priceCents * qtyFactor);
          const { quantityOptions: _q, ...breakdown } = (i.pricingBreakdown ?? {}) as StoredBreakdown;
          return {
            tenantId,
            jobId: job!.id,
            categoryId: i.categoryId,
            description: i.description.replace(/^\d[\d,]*\b/, qty.toLocaleString()),
            quantity: qty,
            widthIn: i.widthIn,
            heightIn: i.heightIn,
            materialId: i.materialId,
            material: i.material,
            finishing: i.finishing,
            colors: i.colors,
            specs: i.specs,
            pricingInput: rp?.pricingInput ?? i.pricingInput,
            pricingBreakdown: rp?.pricingBreakdown ?? (i.pricingBreakdown ? breakdown : null),
            recommendedCents: rp?.recommendedCents ?? i.recommendedCents,
            priceCents: price,
            overrideReason: price !== i.priceCents ? `Reorder of ${jobNo(src.number)} (was $${(i.priceCents / 100).toFixed(2)})` : null,
            estimatedCostCents: rp?.estimatedCostCents ?? Math.round(i.estimatedCostCents * qtyFactor),
            taxable: i.taxable,
            sortOrder: i.sortOrder,
          };
        }),
      );
    // Link the same artwork files (copy rows pointing to the same stored object; originals untouched).
    if (artwork.length)
      await tx.insert(files).values(
        artwork.map((f) => ({
          tenantId,
          jobId: job!.id,
          customerId: f.customerId,
          folder: f.folder,
          filename: f.filename,
          storageKey: f.storageKey,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          preflightStatus: f.preflightStatus,
          preflight: f.preflight,
          uploadedBy: actor.id,
        })),
      );
    await recalcJobTotals(tx, tenantId, job!.id);
    await tx.insert(jobStatusHistory).values({ tenantId, jobId: job!.id, fromStatus: null, toStatus: status, changedBy: actor.id, note: `Reorder of ${jobNo(src.number)}` });
    await logActivity({ tenantId, action: "job.created", entityType: "job", entityId: job!.id, jobId: job!.id, customerId: src.customerId, actorId: actor.id, summary: `Reordered from ${jobNo(src.number)}` }, tx);
    await logActivity({ tenantId, action: "job.reordered", entityType: "job", entityId: src.id, jobId: src.id, customerId: src.customerId, actorId: actor.id, summary: `Reordered as ${jobNo(job!.number)}` }, tx);
    return { number: job!.number };
  });
}

export const isOverdue = (j: { dueDate: string | null; status: JobStatus }) =>
  !!j.dueDate && j.dueDate < today() && WORK_STATUSES.includes(j.status);
