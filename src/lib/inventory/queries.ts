import "server-only";
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  inventoryMovements,
  inventoryReservations,
  jobs,
  materials,
  purchaseOrderItems,
  purchaseOrders,
  users,
  vendors,
  type JobStatus,
} from "@/lib/db/schema";
import { today } from "@/lib/format";
import { availableOf, isPoOverdue, stockStatus, suggestedOrderQty, uncoveredOf, unitCostOf, type InventoryAlerts, type StockStatus } from "./math";

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/** Reserved for jobs and still on order, per material (only materials with any). */
async function levelsFor(tenantId: number, materialIds?: number[]) {
  if (materialIds && !materialIds.length) return { reserved: new Map<number, number>(), onOrder: new Map<number, number>(), onDraft: new Map<number, number>(), neededBy: new Map<number, string>() };
  const [res, ord] = await Promise.all([
    db
      .select({ materialId: inventoryReservations.materialId, qty: sql<number>`sum(${inventoryReservations.quantity})::float8`, neededBy: sql<string | null>`min(${jobs.dueDate})::text` })
      .from(inventoryReservations)
      .innerJoin(jobs, and(eq(jobs.tenantId, inventoryReservations.tenantId), eq(jobs.id, inventoryReservations.jobId)))
      .where(and(eq(inventoryReservations.tenantId, tenantId), eq(inventoryReservations.status, "reserved"), materialIds ? inArray(inventoryReservations.materialId, materialIds) : undefined))
      .groupBy(inventoryReservations.materialId),
    db
      .select({
        materialId: purchaseOrderItems.materialId,
        qty: sql<number>`(sum(greatest(${purchaseOrderItems.quantity} - ${purchaseOrderItems.receivedQuantity}, 0)) filter (where ${purchaseOrders.status} <> 'draft'))::float8`,
        draft: sql<number>`(sum(${purchaseOrderItems.quantity}) filter (where ${purchaseOrders.status} = 'draft'))::float8`,
      })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, and(eq(purchaseOrders.tenantId, purchaseOrderItems.tenantId), eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId)))
      .where(
        and(
          eq(purchaseOrderItems.tenantId, tenantId),
          inArray(purchaseOrders.status, ["draft", "ordered", "partial"]),
          sql`${purchaseOrderItems.materialId} is not null`,
          materialIds ? inArray(purchaseOrderItems.materialId, materialIds) : undefined,
        ),
      )
      .groupBy(purchaseOrderItems.materialId),
  ]);
  return {
    reserved: new Map(res.map((r) => [r.materialId, Number(r.qty)])),
    onOrder: new Map(ord.map((r) => [r.materialId!, Number(r.qty ?? 0)])),
    /** On draft POs not yet placed (not "on order", but counted by Suggested orders so nothing is ordered twice). */
    onDraft: new Map(ord.map((r) => [r.materialId!, Number(r.draft ?? 0)])),
    neededBy: new Map(res.filter((r) => r.neededBy).map((r) => [r.materialId, r.neededBy!])),
  };
}

export type StockRow = {
  id: number;
  name: string;
  kind: string;
  unit: string;
  sku: string | null;
  binLocation: string | null;
  vendorId: number | null;
  vendorName: string | null;
  onHand: number;
  reserved: number;
  onOrder: number;
  onDraft: number;
  available: number;
  reorderLevel: number | null;
  reorderQuantity: number | null;
  status: StockStatus;
  /** Earliest due date of the jobs it's reserved for. */
  neededBy: string | null;
  unitCostCents: number;
  active: boolean;
};

/** Every tracked material with its levels and status. */
export async function listStock(tenantId: number, opts: { ids?: number[] } = {}): Promise<StockRow[]> {
  const rows = await db
    .select({ m: materials, vendorName: vendors.name })
    .from(materials)
    .leftJoin(vendors, and(eq(vendors.tenantId, materials.tenantId), eq(vendors.id, materials.vendorId)))
    .where(and(eq(materials.tenantId, tenantId), eq(materials.trackInventory, true), opts.ids ? inArray(materials.id, opts.ids) : undefined))
    .orderBy(asc(materials.name));
  const lv = await levelsFor(tenantId, rows.map((r) => r.m.id));
  return rows.map(({ m, vendorName }) => {
    const level = { onHand: m.quantityOnHand ?? 0, reserved: lv.reserved.get(m.id) ?? 0, onOrder: lv.onOrder.get(m.id) ?? 0, reorderLevel: m.reorderLevel };
    return {
      id: m.id,
      name: m.name,
      kind: m.kind,
      unit: m.unit,
      sku: m.sku,
      binLocation: m.binLocation,
      vendorId: m.vendorId,
      vendorName,
      ...level,
      onDraft: lv.onDraft.get(m.id) ?? 0,
      available: availableOf(level),
      reorderQuantity: m.reorderQuantity,
      status: stockStatus(level),
      neededBy: lv.neededBy.get(m.id) ?? null,
      unitCostCents: unitCostOf(m),
      active: m.active,
    };
  });
}

/** Materials the shop could start tracking. */
export async function listUntracked(tenantId: number) {
  return db
    .select({ id: materials.id, name: materials.name, kind: materials.kind, unit: materials.unit, binLocation: materials.binLocation, reorderLevel: materials.reorderLevel, reorderQuantity: materials.reorderQuantity })
    .from(materials)
    .where(and(eq(materials.tenantId, tenantId), eq(materials.trackInventory, false), eq(materials.active, true)))
    .orderBy(asc(materials.kind), asc(materials.name));
}

// ---------------------------------------------------------------------------
// One stock item
// ---------------------------------------------------------------------------

export async function getStockItem(tenantId: number, materialId: number) {
  const [row] = await db
    .select({ m: materials, vendorName: vendors.name, vendorEmail: vendors.email })
    .from(materials)
    .leftJoin(vendors, and(eq(vendors.tenantId, materials.tenantId), eq(vendors.id, materials.vendorId)))
    .where(and(eq(materials.tenantId, tenantId), eq(materials.id, materialId)));
  if (!row) return null;
  const m = row.m;
  const [lv, movements, reservations, poLines] = await Promise.all([
    levelsFor(tenantId, [m.id]),
    db
      .select({
        id: inventoryMovements.id,
        kind: inventoryMovements.kind,
        quantity: inventoryMovements.quantity,
        balanceAfter: inventoryMovements.balanceAfter,
        note: inventoryMovements.note,
        createdAt: inventoryMovements.createdAt,
        who: users.name,
        jobNumber: jobs.number,
        poId: purchaseOrders.id,
        poNumber: purchaseOrders.number,
      })
      .from(inventoryMovements)
      .leftJoin(users, and(eq(users.tenantId, inventoryMovements.tenantId), eq(users.id, inventoryMovements.createdBy)))
      .leftJoin(jobs, and(eq(jobs.tenantId, inventoryMovements.tenantId), eq(jobs.id, inventoryMovements.jobId)))
      .leftJoin(purchaseOrders, and(eq(purchaseOrders.tenantId, inventoryMovements.tenantId), eq(purchaseOrders.id, inventoryMovements.purchaseOrderId)))
      .where(and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.materialId, m.id)))
      .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
      .limit(200),
    db
      .select({
        jobId: jobs.id,
        number: jobs.number,
        title: jobs.title,
        dueDate: jobs.dueDate,
        status: jobs.status,
        quantity: sql<number>`sum(${inventoryReservations.quantity})::float8`,
      })
      .from(inventoryReservations)
      .innerJoin(jobs, and(eq(jobs.tenantId, inventoryReservations.tenantId), eq(jobs.id, inventoryReservations.jobId)))
      .where(and(eq(inventoryReservations.tenantId, tenantId), eq(inventoryReservations.materialId, m.id), eq(inventoryReservations.status, "reserved")))
      .groupBy(jobs.id)
      .orderBy(sql`${jobs.dueDate} asc nulls last`, asc(jobs.number)),
    db
      .select({
        lineId: purchaseOrderItems.id,
        poId: purchaseOrders.id,
        number: purchaseOrders.number,
        status: purchaseOrders.status,
        expectedOn: purchaseOrders.expectedOn,
        orderedOn: purchaseOrders.orderedOn,
        quantity: purchaseOrderItems.quantity,
        receivedQuantity: purchaseOrderItems.receivedQuantity,
        unitCostCents: purchaseOrderItems.unitCostCents,
        vendorName: vendors.name,
      })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, and(eq(purchaseOrders.tenantId, purchaseOrderItems.tenantId), eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId)))
      .innerJoin(vendors, and(eq(vendors.tenantId, purchaseOrders.tenantId), eq(vendors.id, purchaseOrders.vendorId)))
      .where(and(eq(purchaseOrderItems.tenantId, tenantId), eq(purchaseOrderItems.materialId, m.id), inArray(purchaseOrders.status, ["draft", "ordered", "partial"])))
      .orderBy(asc(purchaseOrders.number)),
  ]);
  const [last] = await db
    .select({ unitCostCents: purchaseOrderItems.unitCostCents, number: purchaseOrders.number, orderedOn: purchaseOrders.orderedOn })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, and(eq(purchaseOrders.tenantId, purchaseOrderItems.tenantId), eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId)))
    .where(and(eq(purchaseOrderItems.tenantId, tenantId), eq(purchaseOrderItems.materialId, m.id), inArray(purchaseOrders.status, ["ordered", "partial", "received"])))
    .orderBy(desc(purchaseOrders.orderedOn), desc(purchaseOrders.id))
    .limit(1);
  const level = { onHand: m.quantityOnHand ?? 0, reserved: lv.reserved.get(m.id) ?? 0, onOrder: lv.onOrder.get(m.id) ?? 0, reorderLevel: m.reorderLevel };
  const lastCount = movements.find((x) => x.kind === "count");
  return {
    material: m,
    vendorName: row.vendorName,
    level,
    available: availableOf(level),
    status: stockStatus(level),
    uncovered: uncoveredOf(level),
    suggested: suggestedOrderQty({ ...level, onOrder: level.onOrder + (lv.onDraft.get(m.id) ?? 0), unit: m.unit, reorderQuantity: m.reorderQuantity }),
    unitCostCents: unitCostOf(m),
    lastPo: last ?? null,
    lastCountedAt: lastCount?.createdAt ?? null,
    movements,
    reservations: reservations.map((r) => ({ ...r, quantity: Number(r.quantity) })),
    poLines,
  };
}

/** Open jobs to pick from ("Use on a job", PO lines): newest first. */
export async function openJobsForPicker(tenantId: number) {
  return db
    .select({ id: jobs.id, number: jobs.number, title: jobs.title })
    .from(jobs)
    .where(and(eq(jobs.tenantId, tenantId), isNull(jobs.archivedAt), notInArray(jobs.status, ["completed", "cancelled"] as JobStatus[])))
    .orderBy(desc(jobs.number))
    .limit(400);
}

// ---------------------------------------------------------------------------
// A job's materials (for the job page)
// ---------------------------------------------------------------------------

export type JobMaterialRow = {
  materialId: number;
  name: string;
  unit: string;
  binLocation: string | null;
  reserved: number;
  used: number;
  onHand: number;
  /** Everything reserved for all jobs. */
  reservedAll: number;
  onOrder: number;
  /** This job's reserved quantity isn't covered by the shelf once earlier jobs take theirs. */
  short: boolean;
};

/**
 * Stock reserved for / used on a job. A line is flagged short when everything reserved for jobs due
 * no later than this one is more than what's on the shelf.
 */
export async function getJobMaterials(tenantId: number, jobId: number): Promise<JobMaterialRow[]> {
  const rows = await db
    .select({
      materialId: inventoryReservations.materialId,
      status: inventoryReservations.status,
      qty: sql<number>`sum(${inventoryReservations.quantity})::float8`,
    })
    .from(inventoryReservations)
    .where(and(eq(inventoryReservations.tenantId, tenantId), eq(inventoryReservations.jobId, jobId), inArray(inventoryReservations.status, ["reserved", "used"])))
    .groupBy(inventoryReservations.materialId, inventoryReservations.status);
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.materialId))];
  const [mats, lv, [job]] = await Promise.all([
    db
      .select({ id: materials.id, name: materials.name, unit: materials.unit, binLocation: materials.binLocation, onHand: materials.quantityOnHand, tracked: materials.trackInventory })
      .from(materials)
      .where(and(eq(materials.tenantId, tenantId), inArray(materials.id, ids))),
    levelsFor(tenantId, ids),
    db.select({ dueDate: jobs.dueDate }).from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId))),
  ]);
  // Reserved for jobs due on/before this one (they'll take the stock first).
  const ahead = await db
    .select({ materialId: inventoryReservations.materialId, qty: sql<number>`sum(${inventoryReservations.quantity})::float8` })
    .from(inventoryReservations)
    .innerJoin(jobs, and(eq(jobs.tenantId, inventoryReservations.tenantId), eq(jobs.id, inventoryReservations.jobId)))
    .where(
      and(
        eq(inventoryReservations.tenantId, tenantId),
        inArray(inventoryReservations.materialId, ids),
        eq(inventoryReservations.status, "reserved"),
        job?.dueDate ? sql`(${jobs.id} = ${jobId} or (${jobs.dueDate} is not null and ${jobs.dueDate} <= ${job.dueDate}))` : undefined,
      ),
    )
    .groupBy(inventoryReservations.materialId);
  const aheadBy = new Map(ahead.map((a) => [a.materialId, Number(a.qty)]));
  return mats
    .filter((m) => m.tracked)
    .map((m) => {
      const reserved = Number(rows.find((r) => r.materialId === m.id && r.status === "reserved")?.qty ?? 0);
      const used = Number(rows.find((r) => r.materialId === m.id && r.status === "used")?.qty ?? 0);
      const onHand = m.onHand ?? 0;
      return {
        materialId: m.id,
        name: m.name,
        unit: m.unit,
        binLocation: m.binLocation,
        reserved,
        used,
        onHand,
        reservedAll: lv.reserved.get(m.id) ?? 0,
        onOrder: lv.onOrder.get(m.id) ?? 0,
        short: reserved > 0 && (aheadBy.get(m.id) ?? reserved) > onHand,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * Counts for the dashboard's "Needs attention": tracked items that are low, out, or short for jobs
 * (reserved > on hand), and purchase orders past their expected date.
 */
export async function getInventoryAlerts(tenantId: number): Promise<InventoryAlerts> {
  const [stock, late] = await Promise.all([
    listStock(tenantId),
    db
      .select({ status: purchaseOrders.status, expectedOn: purchaseOrders.expectedOn })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.tenantId, tenantId), inArray(purchaseOrders.status, ["ordered", "partial"]), sql`${purchaseOrders.expectedOn} < ${today()}`)),
  ]);
  const active = stock.filter((s) => s.active);
  const t = today();
  return {
    low: active.filter((s) => s.status === "low").length,
    out: active.filter((s) => s.status === "out").length,
    short: active.filter((s) => s.status === "short").length,
    overduePos: late.filter((p) => isPoOverdue(p, t)).length,
  };
}

// ---------------------------------------------------------------------------
// Reorder suggestions
// ---------------------------------------------------------------------------

export type Suggestion = StockRow & { suggested: number; uncovered: number };

/** Tracked items to order, grouped by vendor (items without a vendor come last). */
export async function suggestedOrders(tenantId: number) {
  const stock = await listStock(tenantId);
  const items: Suggestion[] = stock
    .filter((s) => s.active)
    // Quantities on draft POs count as coming, so nothing is ordered twice.
    .map((s) => ({ ...s, suggested: suggestedOrderQty({ ...s, onOrder: s.onOrder + s.onDraft }), uncovered: uncoveredOf(s) }))
    .filter((s) => s.suggested > 0);
  const groups = new Map<string, { vendorId: number | null; vendorName: string; items: Suggestion[] }>();
  for (const s of items) {
    const key = String(s.vendorId ?? "none");
    if (!groups.has(key)) groups.set(key, { vendorId: s.vendorId, vendorName: s.vendorName ?? "No vendor set", items: [] });
    groups.get(key)!.items.push(s);
  }
  return [...groups.values()].sort((a, b) => (a.vendorId == null ? 1 : b.vendorId == null ? -1 : a.vendorName.localeCompare(b.vendorName)));
}
