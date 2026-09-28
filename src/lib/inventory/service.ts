import "server-only";
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { inventoryMovements, inventoryReservations, jobItems, jobs, materials, purchaseOrderItems, purchaseOrders, type Material } from "@/lib/db/schema";
import { logActivity, type ActivityInput } from "@/lib/activity";
import { UserError } from "@/lib/actions";
import { jobNo, poNo, today } from "@/lib/format";
import { getJobPrefix } from "@/lib/tenant";
import {
  USE_STATUSES,
  fmtQty,
  planReservations,
  poStatusAfterReceive,
  qtyWithUnit,
  remainingOf,
  reservationActionFor,
  reservationNeeds,
  roundQty,
  sameReservations,
  type TrackedMaterial,
} from "./math";

export type MovementKind = "receive" | "use" | "adjust" | "count" | "return";

/** Activity for stock items and purchase orders. */
export function logInventory(tx: Tx, input: ActivityInput & { entityType: "material" | "purchase_order" }) {
  return logActivity(input, tx);
}

/** A material of this shop, locked until the transaction ends (so two receipts can't race). */
export async function lockMaterial(tx: Tx, tenantId: number, materialId: number): Promise<Material | null> {
  const [m] = await tx
    .select()
    .from(materials)
    .where(and(eq(materials.tenantId, tenantId), eq(materials.id, materialId)))
    .for("update");
  return m ?? null;
}

/**
 * THE one place stock changes: locks the material, writes the ledger row with the running balance
 * and updates quantityOnHand. `quantity` is signed (+ in, − out).
 */
export async function recordMovement(
  tx: Tx,
  tenantId: number,
  input: { materialId: number; kind: MovementKind; quantity: number; jobId?: number | null; purchaseOrderId?: number | null; note?: string | null; actorId?: number | null },
) {
  const m = await lockMaterial(tx, tenantId, input.materialId);
  if (!m) throw new UserError("Stock item not found.");
  if (!m.trackInventory) throw new UserError(`${m.name} isn't being tracked. Start tracking it first.`);
  const quantity = roundQty(input.quantity);
  const before = m.quantityOnHand ?? 0;
  const after = roundQty(before + quantity);
  if (Math.abs(after) >= 1e10) throw new UserError("That quantity is too large.");
  const [row] = await tx
    .insert(inventoryMovements)
    .values({
      tenantId,
      materialId: m.id,
      kind: input.kind,
      quantity,
      balanceAfter: after,
      jobId: input.jobId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      note: input.note?.trim() || null,
      createdBy: input.actorId ?? null,
    })
    .returning({ id: inventoryMovements.id });
  await tx.update(materials).set({ quantityOnHand: after }).where(and(eq(materials.tenantId, tenantId), eq(materials.id, m.id)));
  return { movementId: row!.id, material: m, before, after, quantity };
}

// ---------------------------------------------------------------------------
// Reservations: stock set aside for jobs
// ---------------------------------------------------------------------------

async function trackedMaterials(tx: Tx, tenantId: number): Promise<Map<number, TrackedMaterial & { name: string }>> {
  const rows = await tx
    .select({ id: materials.id, unit: materials.unit, name: materials.name })
    .from(materials)
    .where(and(eq(materials.tenantId, tenantId), eq(materials.trackInventory, true)));
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Keep a job's stock in step with the job. Call after changing its items or status, inside the same
 * transaction. Idempotent, and a single query when the shop tracks nothing.
 * - open jobs (before printing): reserve what the items need (minus anything already used on the job);
 * - printed (finishing … completed): take the reserved stock off the shelf, once ("use" movements);
 * - cancelled or archived: give reserved stock back.
 */
export async function syncJobReservations(tx: Tx, tenantId: number, jobId: number, actorId: number | null = null) {
  const tracked = await trackedMaterials(tx, tenantId);
  if (!tracked.size) return;
  const [job] = await tx
    .select({ id: jobs.id, number: jobs.number, status: jobs.status, archivedAt: jobs.archivedAt })
    .from(jobs)
    .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId)));
  if (!job) return;
  const rows = await tx.select().from(inventoryReservations).where(and(eq(inventoryReservations.tenantId, tenantId), eq(inventoryReservations.jobId, jobId)));
  const reserved = rows.filter((r) => r.status === "reserved");
  const action = reservationActionFor(job.status, !!job.archivedAt);

  if (action === "release") {
    if (reserved.length)
      await tx
        .update(inventoryReservations)
        .set({ status: "released", updatedAt: new Date() })
        .where(and(eq(inventoryReservations.tenantId, tenantId), eq(inventoryReservations.jobId, jobId), eq(inventoryReservations.status, "reserved")));
    return;
  }

  if (action === "use") {
    if (reserved.length) await takeReservedStock(tx, tenantId, job, reserved, tracked, actorId);
    return;
  }

  const items = await tx
    .select({ id: jobItems.id, quantity: jobItems.quantity, widthIn: jobItems.widthIn, heightIn: jobItems.heightIn, materialId: jobItems.materialId, pricingBreakdown: jobItems.pricingBreakdown })
    .from(jobItems)
    .where(and(eq(jobItems.tenantId, tenantId), eq(jobItems.jobId, jobId)))
    .orderBy(asc(jobItems.sortOrder), asc(jobItems.id));
  const used = new Map<number, number>();
  for (const r of rows) if (r.status === "used") used.set(r.materialId, roundQty((used.get(r.materialId) ?? 0) + r.quantity));
  const plan = planReservations(reservationNeeds(items, tracked), used);
  if (sameReservations(reserved, plan)) return;
  // Reserved rows are derived from the job's items: replace them. Used/released rows are history and stay.
  await tx.delete(inventoryReservations).where(and(eq(inventoryReservations.tenantId, tenantId), eq(inventoryReservations.jobId, jobId), eq(inventoryReservations.status, "reserved")));
  if (plan.length) await tx.insert(inventoryReservations).values(plan.map((p) => ({ tenantId, jobId, jobItemId: p.jobItemId, materialId: p.materialId, quantity: p.quantity, status: "reserved" as const })));
}

/** Printed: move a job's reserved stock off the shelf (one "use" movement per material). */
async function takeReservedStock(
  tx: Tx,
  tenantId: number,
  job: { id: number; number: number },
  reserved: (typeof inventoryReservations.$inferSelect)[],
  tracked: Map<number, TrackedMaterial & { name: string }>,
  actorId: number | null,
) {
  const label = jobNo(job.number, await getJobPrefix(tenantId));
  const byMaterial = new Map<number, number>();
  for (const r of reserved) byMaterial.set(r.materialId, roundQty((byMaterial.get(r.materialId) ?? 0) + r.quantity));
  const parts: string[] = [];
  // Lock materials in id order so two jobs finishing at once can't deadlock.
  for (const materialId of [...byMaterial.keys()].sort((a, b) => a - b)) {
    const m = tracked.get(materialId);
    if (!m) continue; // no longer tracked: its rows are released below
    const qty = byMaterial.get(materialId)!;
    await recordMovement(tx, tenantId, { materialId, kind: "use", quantity: -qty, jobId: job.id, note: `Printed — reserved for ${label}`, actorId });
    parts.push(`${qtyWithUnit(qty, m.unit)} ${m.name}`);
  }
  const ids = reserved.filter((r) => tracked.has(r.materialId)).map((r) => r.id);
  const gone = reserved.filter((r) => !tracked.has(r.materialId)).map((r) => r.id);
  if (ids.length) await tx.update(inventoryReservations).set({ status: "used", updatedAt: new Date() }).where(and(eq(inventoryReservations.tenantId, tenantId), inArray(inventoryReservations.id, ids)));
  if (gone.length) await tx.update(inventoryReservations).set({ status: "released", updatedAt: new Date() }).where(and(eq(inventoryReservations.tenantId, tenantId), inArray(inventoryReservations.id, gone)));
  if (parts.length)
    await logActivity({ tenantId, action: "inventory.used", entityType: "job", entityId: job.id, jobId: job.id, actorId, summary: `Took from stock: ${parts.join(", ")}` }, tx);
}

/**
 * Stock used on a job by hand ("Use on a job"): the job's reservation for that material is marked used
 * first, so it isn't taken off the shelf a second time when the job is printed.
 */
async function consumeReservations(tx: Tx, tenantId: number, jobId: number, materialId: number, qty: number) {
  const rows = await tx
    .select()
    .from(inventoryReservations)
    .where(and(eq(inventoryReservations.tenantId, tenantId), eq(inventoryReservations.jobId, jobId), eq(inventoryReservations.materialId, materialId), eq(inventoryReservations.status, "reserved")))
    .orderBy(asc(inventoryReservations.id));
  let left = roundQty(qty);
  const now = new Date();
  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(left, r.quantity);
    if (take >= r.quantity) await tx.update(inventoryReservations).set({ status: "used", updatedAt: now }).where(and(eq(inventoryReservations.tenantId, tenantId), eq(inventoryReservations.id, r.id)));
    else {
      await tx.update(inventoryReservations).set({ quantity: roundQty(r.quantity - take), updatedAt: now }).where(and(eq(inventoryReservations.tenantId, tenantId), eq(inventoryReservations.id, r.id)));
      await tx.insert(inventoryReservations).values({ tenantId, jobId, jobItemId: r.jobItemId, materialId, quantity: take, status: "used" });
    }
    left = roundQty(left - take);
  }
  // Used beyond what was reserved: keep it on the job's record too.
  if (left > 0) await tx.insert(inventoryReservations).values({ tenantId, jobId, jobItemId: null, materialId, quantity: left, status: "used" });
}

// ---------------------------------------------------------------------------
// Stock actions (each runs inside the caller's transaction)
// ---------------------------------------------------------------------------

export type StockActor = { id: number };

async function jobOf(tx: Tx, tenantId: number, jobId: number) {
  const [j] = await tx.select({ id: jobs.id, number: jobs.number, title: jobs.title, status: jobs.status }).from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId), isNull(jobs.archivedAt)));
  if (!j) throw new UserError("Job not found.");
  return j;
}

/**
 * Stock came in. With a purchase-order line, that line's received quantity (and the PO's status) are
 * updated too.
 */
export async function receiveStock(tx: Tx, tenantId: number, input: { materialId: number; quantity: number; poLineId?: number | null; note?: string | null }, actor: StockActor) {
  if (!(input.quantity > 0)) throw new UserError("Enter how many came in.");
  if (input.poLineId) {
    const [line] = await tx
      .select({ id: purchaseOrderItems.id, poId: purchaseOrderItems.purchaseOrderId, materialId: purchaseOrderItems.materialId })
      .from(purchaseOrderItems)
      .where(and(eq(purchaseOrderItems.tenantId, tenantId), eq(purchaseOrderItems.id, input.poLineId)));
    if (!line || line.materialId !== input.materialId) throw new UserError("That purchase order line isn't for this item.");
    await receivePurchaseOrder(tx, tenantId, line.poId, [{ lineId: line.id, quantity: input.quantity }], actor, input.note);
    return;
  }
  const r = await recordMovement(tx, tenantId, { materialId: input.materialId, kind: "receive", quantity: input.quantity, note: input.note, actorId: actor.id });
  await logInventory(tx, {
    tenantId,
    action: "inventory.received",
    entityType: "material",
    entityId: r.material.id,
    actorId: actor.id,
    summary: `Received ${qtyWithUnit(r.quantity, r.material.unit)} of ${r.material.name}`,
    data: { before: { onHand: r.before }, after: { onHand: r.after } },
  });
}

/** Stock taken off the shelf for a job. */
export async function takeFromStock(tx: Tx, tenantId: number, input: { materialId: number; quantity: number; jobId: number | null; note?: string | null }, actor: StockActor) {
  if (!(input.quantity > 0)) throw new UserError("Enter how much was used.");
  const job = input.jobId ? await jobOf(tx, tenantId, input.jobId) : null;
  const label = job ? jobNo(job.number, await getJobPrefix(tenantId)) : null;
  const r = await recordMovement(tx, tenantId, {
    materialId: input.materialId,
    kind: "use",
    quantity: -input.quantity,
    jobId: job?.id ?? null,
    note: input.note || null,
    actorId: actor.id,
  });
  if (job) await consumeReservations(tx, tenantId, job.id, input.materialId, input.quantity);
  await logInventory(tx, {
    tenantId,
    action: "inventory.used",
    entityType: "material",
    entityId: r.material.id,
    jobId: job?.id ?? null,
    actorId: actor.id,
    summary: `Used ${qtyWithUnit(input.quantity, r.material.unit)} of ${r.material.name}${label ? ` on ${label}` : ""}`,
    data: { before: { onHand: r.before }, after: { onHand: r.after } },
  });
}

/** A correction (+/−) with the reason. */
export async function adjustStock(tx: Tx, tenantId: number, input: { materialId: number; quantity: number; reason: string }, actor: StockActor) {
  if (!input.quantity) throw new UserError("Enter how much to add or take away.");
  if (!input.reason.trim()) throw new UserError("Say why (e.g. “damaged in shipping”).");
  const r = await recordMovement(tx, tenantId, { materialId: input.materialId, kind: "adjust", quantity: input.quantity, note: input.reason, actorId: actor.id });
  await logInventory(tx, {
    tenantId,
    action: "inventory.adjusted",
    entityType: "material",
    entityId: r.material.id,
    actorId: actor.id,
    summary: `Adjusted ${r.material.name} ${input.quantity > 0 ? "+" : "−"}${fmtQty(Math.abs(input.quantity))}: ${input.reason.trim()}`,
    data: { before: { onHand: r.before }, after: { onHand: r.after } },
  });
}

/** A physical count: the ledger records the difference from what the system thought. */
export async function countStock(tx: Tx, tenantId: number, input: { materialId: number; counted: number; note?: string | null }, actor: StockActor) {
  if (!(input.counted >= 0)) throw new UserError("Enter the number you counted (0 or more).");
  const m = await lockMaterial(tx, tenantId, input.materialId);
  if (!m) throw new UserError("Stock item not found.");
  const diff = roundQty(input.counted - (m.quantityOnHand ?? 0));
  const r = await recordMovement(tx, tenantId, { materialId: m.id, kind: "count", quantity: diff, note: input.note || `Counted ${fmtQty(input.counted)}`, actorId: actor.id });
  await logInventory(tx, {
    tenantId,
    action: "inventory.counted",
    entityType: "material",
    entityId: m.id,
    actorId: actor.id,
    summary: `Counted ${m.name}: ${qtyWithUnit(input.counted, m.unit)}${diff ? ` (${diff > 0 ? "+" : "−"}${fmtQty(Math.abs(diff))})` : " (no change)"}`,
    data: { before: { onHand: r.before }, after: { onHand: r.after } },
  });
  return { diff };
}

/** Jobs not yet printed whose lines use a material (by its id, or as the paper of a print estimate). */
async function openJobsUsing(tx: Tx, tenantId: number, materialId: number) {
  const rows = await tx
    .selectDistinct({ id: jobs.id })
    .from(jobs)
    .innerJoin(jobItems, and(eq(jobItems.tenantId, jobs.tenantId), eq(jobItems.jobId, jobs.id)))
    .where(
      and(
        eq(jobs.tenantId, tenantId),
        isNull(jobs.archivedAt),
        notInArray(jobs.status, [...USE_STATUSES, "cancelled"]),
        or(eq(jobItems.materialId, materialId), sql`${jobItems.pricingBreakdown}->'production'->>'paperId' = ${String(materialId)}`),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Start counting a material's stock: sets the opening count (as a "count" movement), reorder level,
 * reorder quantity and bin, then reserves it for open jobs that use it. Jobs already printed aren't
 * touched (their stock was used before counting started).
 */
export async function startTracking(
  tx: Tx,
  tenantId: number,
  input: { materialId: number; onHand: number; reorderLevel: number | null; reorderQuantity: number | null; binLocation: string | null },
  actor: StockActor,
) {
  const m = await lockMaterial(tx, tenantId, input.materialId);
  if (!m) throw new UserError("Material not found.");
  if (m.trackInventory) throw new UserError(`${m.name} is already tracked.`);
  if (!(input.onHand >= 0)) throw new UserError("Enter how many you have now (0 or more).");
  await tx
    .update(materials)
    .set({ trackInventory: true, quantityOnHand: 0, reorderLevel: input.reorderLevel, reorderQuantity: input.reorderQuantity, binLocation: input.binLocation })
    .where(and(eq(materials.tenantId, tenantId), eq(materials.id, m.id)));
  await recordMovement(tx, tenantId, { materialId: m.id, kind: "count", quantity: input.onHand, note: "Started tracking — opening count", actorId: actor.id });
  await logInventory(tx, {
    tenantId,
    action: "inventory.tracking_started",
    entityType: "material",
    entityId: m.id,
    actorId: actor.id,
    summary: `Started tracking ${m.name}: ${qtyWithUnit(input.onHand, m.unit)} on hand`,
    data: { before: null, after: { onHand: input.onHand, reorderLevel: input.reorderLevel, reorderQuantity: input.reorderQuantity, binLocation: input.binLocation } },
  });
  for (const jobId of await openJobsUsing(tx, tenantId, m.id)) await syncJobReservations(tx, tenantId, jobId, actor.id);
}

/** Stop tracking: reservations are given back; the ledger stays. */
export async function stopTracking(tx: Tx, tenantId: number, materialId: number, actor: StockActor) {
  const m = await lockMaterial(tx, tenantId, materialId);
  if (!m) throw new UserError("Material not found.");
  if (!m.trackInventory) return;
  await tx.update(materials).set({ trackInventory: false }).where(and(eq(materials.tenantId, tenantId), eq(materials.id, m.id)));
  await tx
    .update(inventoryReservations)
    .set({ status: "released", updatedAt: new Date() })
    .where(and(eq(inventoryReservations.tenantId, tenantId), eq(inventoryReservations.materialId, m.id), eq(inventoryReservations.status, "reserved")));
  await logInventory(tx, { tenantId, action: "inventory.tracking_stopped", entityType: "material", entityId: m.id, actorId: actor.id, summary: `Stopped tracking ${m.name}` });
}

// ---------------------------------------------------------------------------
// Purchase orders: receiving
// ---------------------------------------------------------------------------

/**
 * Receive quantities against a PO's lines (partial allowed). Stock lines add "receive" movements;
 * the PO becomes partly received or received.
 */
export async function receivePurchaseOrder(tx: Tx, tenantId: number, poId: number, receipts: { lineId: number; quantity: number }[], actor: StockActor, note?: string | null) {
  const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, poId))).for("update");
  if (!po) throw new UserError("Purchase order not found.");
  if (po.status === "draft") throw new UserError("Mark this purchase order as ordered before receiving it.");
  if (po.status === "cancelled") throw new UserError("This purchase order was cancelled.");
  const lines = await tx
    .select()
    .from(purchaseOrderItems)
    .where(and(eq(purchaseOrderItems.tenantId, tenantId), eq(purchaseOrderItems.purchaseOrderId, po.id)))
    .orderBy(asc(purchaseOrderItems.sortOrder), asc(purchaseOrderItems.id));
  const byId = new Map(lines.map((l) => [l.id, l]));
  // Lines for tracked materials go into stock; the rest (outside services, untracked items) are just ticked off.
  const matIds = [...new Set(lines.map((l) => l.materialId).filter((x): x is number => !!x))];
  const tracked = new Set(
    matIds.length
      ? (await tx.select({ id: materials.id }).from(materials).where(and(eq(materials.tenantId, tenantId), inArray(materials.id, matIds), eq(materials.trackInventory, true)))).map((m) => m.id)
      : [],
  );
  const got = receipts.filter((r) => r.quantity > 0);
  if (!got.length) throw new UserError("Enter what came in on at least one line.");
  const parts: string[] = [];
  for (const r of got) {
    const line = byId.get(r.lineId);
    if (!line) throw new UserError("That line isn't on this purchase order.");
    const qty = roundQty(r.quantity);
    if (line.materialId && tracked.has(line.materialId)) {
      const mv = await recordMovement(tx, tenantId, { materialId: line.materialId, kind: "receive", quantity: qty, purchaseOrderId: po.id, jobId: line.jobId ?? po.jobId, note: note || null, actorId: actor.id });
      parts.push(`${qtyWithUnit(qty, mv.material.unit)} ${mv.material.name}`);
    } else parts.push(`${fmtQty(qty)} × ${line.description}`);
    line.receivedQuantity = roundQty(line.receivedQuantity + qty);
    await tx.update(purchaseOrderItems).set({ receivedQuantity: line.receivedQuantity }).where(and(eq(purchaseOrderItems.tenantId, tenantId), eq(purchaseOrderItems.id, line.id)));
  }
  const status = poStatusAfterReceive(lines);
  await tx
    .update(purchaseOrders)
    .set({ status, receivedOn: status === "received" ? today() : null, updatedAt: new Date() })
    .where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, po.id)));
  const left = lines.filter((l) => remainingOf(l) > 0).length;
  await logInventory(tx, {
    tenantId,
    action: "po.received",
    entityType: "purchase_order",
    entityId: po.id,
    jobId: po.jobId,
    actorId: actor.id,
    summary: `Received on ${poNo(po.number)}: ${parts.join(", ")}${status === "received" ? " — all in" : ` — ${left} line${left === 1 ? "" : "s"} still to come`}`,
    data: { before: { status: po.status }, after: { status } },
  });
  return { status };
}
