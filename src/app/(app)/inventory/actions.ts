"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { inventoryReservations, materials } from "@/lib/db/schema";
import { requirePermission } from "@/lib/auth";
import { runAction, UserError, int, str, type ActionResult } from "@/lib/actions";
import { isBigChange, parseQty, qtyWithUnit, roundQty } from "@/lib/inventory/math";
import { adjustStock, countStock, logInventory, receivePurchaseOrder, receiveStock, startTracking, stopTracking, syncJobReservations, takeFromStock } from "@/lib/inventory/service";
import { cancelPurchaseOrder, createSuggestedDrafts, placeOrder, saveVendor, savePurchaseOrder, type PoInput } from "@/lib/inventory/purchasing";

type Prev = ActionResult | null;

/** Errors starting with this ask the person to double-check; the form shows "Yes, that's right" (see StockForm). */
const CONFIRM = "CONFIRM:";

function revalidateStock(materialId?: number) {
  revalidatePath("/inventory");
  revalidatePath("/inventory/reorder");
  if (materialId) revalidatePath(`/inventory/${materialId}`);
  revalidatePath("/dashboard");
}

function revalidatePo(id?: number) {
  revalidatePath("/inventory/purchase-orders");
  if (id) revalidatePath(`/inventory/purchase-orders/${id}`);
  revalidateStock();
}

/** A tracked material of the user's shop (another shop's id is "not found"). */
async function stockItem(tenantId: number, id: number | null) {
  if (!id) throw new UserError("Choose a stock item.");
  const [m] = await db.select().from(materials).where(and(eq(materials.tenantId, tenantId), eq(materials.id, id)));
  if (!m) throw new UserError("Stock item not found.");
  return m;
}

/** Quantity from a form field: a number with at most 2 decimals, within a sane range. */
function qtyField(fd: FormData, key: string, label: string, opts: { allowZero?: boolean; allowNegative?: boolean } = {}) {
  const n = parseQty(str(fd, key));
  if (n == null) throw new UserError(`Enter the ${label}.`);
  if (Math.abs(n) > 100_000_000) throw new UserError(`That ${label} looks too large.`);
  if (!opts.allowNegative && n < 0) throw new UserError(`The ${label} can't be negative.`);
  if (!opts.allowZero && n === 0) throw new UserError(`The ${label} can't be zero.`);
  return n;
}

const optQty = (fd: FormData, key: string) => {
  const n = parseQty(str(fd, key));
  if (n != null && (n < 0 || n > 100_000_000)) throw new UserError("Reorder numbers must be 0 or more.");
  return n;
};

/**
 * Big changes (a typo like 25000 for 2500) need a second click: the form sends confirmed=1 after the
 * person has seen the warning.
 */
function guardBig(fd: FormData, m: { quantityOnHand: number | null; reorderLevel: number | null; reorderQuantity: number | null; unit: string }, delta: number, what: string) {
  if (fd.get("confirmed") === "1") return;
  if (isBigChange(delta, { onHand: m.quantityOnHand ?? 0, reorderLevel: m.reorderLevel, reorderQuantity: m.reorderQuantity }))
    throw new UserError(`${CONFIRM}${what} ${qtyWithUnit(Math.abs(delta), m.unit)} is a lot more than usual for this item. Is that number right?`);
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export async function startTrackingAction(_prev: Prev, fd: FormData): Promise<ActionResult<{ id: number }>> {
  return runAction(async () => {
    const user = await requirePermission("inventory.edit");
    const m = await stockItem(user.tenantId, int(fd, "materialId"));
    const onHand = qtyField(fd, "onHand", "number on hand", { allowZero: true });
    await db.transaction((tx) =>
      startTracking(tx, user.tenantId, { materialId: m.id, onHand, reorderLevel: optQty(fd, "reorderLevel"), reorderQuantity: optQty(fd, "reorderQuantity"), binLocation: str(fd, "binLocation")?.slice(0, 120) ?? null }, user),
    );
    revalidateStock(m.id);
    return { id: m.id };
  }, "Now tracking");
}

export async function saveStockSettings(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("inventory.edit");
    const m = await stockItem(user.tenantId, int(fd, "materialId"));
    const after = { reorderLevel: optQty(fd, "reorderLevel"), reorderQuantity: optQty(fd, "reorderQuantity"), binLocation: str(fd, "binLocation")?.slice(0, 120) ?? null };
    await db.transaction(async (tx) => {
      await tx.update(materials).set(after).where(and(eq(materials.tenantId, user.tenantId), eq(materials.id, m.id)));
      await logInventory(tx, {
        tenantId: user.tenantId,
        action: "inventory.settings_changed",
        entityType: "material",
        entityId: m.id,
        actorId: user.id,
        summary: `Updated reorder settings for ${m.name}`,
        data: { before: { reorderLevel: m.reorderLevel, reorderQuantity: m.reorderQuantity, binLocation: m.binLocation }, after },
      });
    });
    revalidateStock(m.id);
  }, "Saved");
}

export async function stopTrackingAction(materialId: number): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("inventory.edit");
    const m = await stockItem(user.tenantId, materialId);
    await db.transaction((tx) => stopTracking(tx, user.tenantId, m.id, user));
    revalidateStock(m.id);
  }, "No longer tracked");
}

// ---------------------------------------------------------------------------
// Receive / use / adjust / count
// ---------------------------------------------------------------------------

export async function receiveAction(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("inventory.edit");
    const m = await stockItem(user.tenantId, int(fd, "materialId"));
    const qty = qtyField(fd, "quantity", "quantity received");
    guardBig(fd, m, qty, "Receiving");
    await db.transaction((tx) => receiveStock(tx, user.tenantId, { materialId: m.id, quantity: qty, poLineId: int(fd, "poLineId"), note: str(fd, "note") }, user));
    revalidateStock(m.id);
    revalidatePath("/inventory/purchase-orders");
    return undefined;
  }, "Received");
}

export async function takeFromStockAction(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("inventory.edit");
    const m = await stockItem(user.tenantId, int(fd, "materialId"));
    const qty = qtyField(fd, "quantity", "quantity used");
    guardBig(fd, m, qty, "Using");
    if (fd.get("confirmed") !== "1" && qty > (m.quantityOnHand ?? 0))
      throw new UserError(`${CONFIRM}That's more than the ${qtyWithUnit(m.quantityOnHand ?? 0, m.unit)} on hand, so stock will go below zero. Is that number right?`);
    await db.transaction((tx) => takeFromStock(tx, user.tenantId, { materialId: m.id, quantity: qty, jobId: int(fd, "jobId"), note: str(fd, "note") }, user));
    revalidateStock(m.id);
  }, "Recorded");
}

export async function adjustAction(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("inventory.edit");
    const m = await stockItem(user.tenantId, int(fd, "materialId"));
    const sign = fd.get("direction") === "remove" ? -1 : 1;
    const qty = qtyField(fd, "quantity", "amount") * sign;
    guardBig(fd, m, qty, sign > 0 ? "Adding" : "Taking away");
    await db.transaction((tx) => adjustStock(tx, user.tenantId, { materialId: m.id, quantity: qty, reason: str(fd, "reason") ?? "" }, user));
    revalidateStock(m.id);
  }, "Adjusted");
}

export async function countAction(_prev: Prev, fd: FormData): Promise<ActionResult<{ diff: number }>> {
  return runAction(async () => {
    const user = await requirePermission("inventory.edit");
    const m = await stockItem(user.tenantId, int(fd, "materialId"));
    const counted = qtyField(fd, "counted", "number you counted", { allowZero: true });
    guardBig(fd, m, roundQty(counted - (m.quantityOnHand ?? 0)), "A difference of");
    const r = await db.transaction((tx) => countStock(tx, user.tenantId, { materialId: m.id, counted, note: str(fd, "note") }, user));
    revalidateStock(m.id);
    return r;
  }, "Count saved");
}

/** Job page: take everything reserved for a job off the shelf now (before its status changes). */
export async function takeJobMaterialsNow(jobId: number): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("inventory.edit");
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({ materialId: inventoryReservations.materialId, quantity: inventoryReservations.quantity })
        .from(inventoryReservations)
        .where(and(eq(inventoryReservations.tenantId, user.tenantId), eq(inventoryReservations.jobId, jobId), eq(inventoryReservations.status, "reserved")));
      if (!rows.length) throw new UserError("Nothing is reserved for this job.");
      const by = new Map<number, number>();
      for (const r of rows) by.set(r.materialId, roundQty((by.get(r.materialId) ?? 0) + r.quantity));
      for (const [materialId, quantity] of [...by].sort((a, b) => a[0] - b[0])) await takeFromStock(tx, user.tenantId, { materialId, quantity, jobId }, user);
    });
    revalidateStock();
    revalidatePath("/jobs", "layout");
  }, "Taken from stock");
}

/** Re-check a job's reservations (e.g. after tracking settings change). */
export async function resyncJob(jobId: number): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("inventory.edit");
    await db.transaction((tx) => syncJobReservations(tx, user.tenantId, jobId, user.id));
    revalidateStock();
  });
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

const PoLine = z.object({
  materialId: z.number().int().positive().nullable(),
  description: z.string().max(300),
  quantity: z.number().positive("Every line needs a quantity.").max(100_000_000),
  unit: z.string().max(20).nullable(),
  unitCostCents: z.number().min(0).max(100_000_000),
  jobId: z.number().int().positive().nullable(),
});
const Po = z.object({
  vendorId: z.number({ error: "Choose a vendor." }).int().positive("Choose a vendor."),
  locationId: z.number().int().positive().nullable(),
  expectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  jobId: z.number().int().positive().nullable(),
  notes: z.string().max(4000).nullable(),
  shippingCents: z.number().int().min(0).max(100_000_000),
  taxCents: z.number().int().min(0).max(100_000_000),
  lines: z.array(PoLine).min(1, "Add at least one line to the order.").max(200),
});

export async function savePoAction(id: number | null, input: PoInput): Promise<ActionResult<{ id: number }>> {
  return runAction(async () => {
    const user = await requirePermission("purchasing.edit");
    const data = Po.parse(input);
    const po = await db.transaction((tx) => savePurchaseOrder(tx, user.tenantId, id, data, user));
    revalidatePo(po.id);
    return { id: po.id };
  }, id ? "Purchase order saved" : "Purchase order created");
}

export async function placeOrderAction(id: number, opts: { email: string | null; message: string | null; saveEmail: boolean }): Promise<ActionResult<{ emailed: string | null }>> {
  return runAction(async () => {
    const user = await requirePermission("purchasing.edit");
    const clean = { email: opts.email?.trim() || null, message: opts.message?.slice(0, 2000) ?? null, saveEmail: !!opts.saveEmail };
    const r = await db.transaction((tx) => placeOrder(tx, user.tenantId, id, clean, user));
    revalidatePo(id);
    return r;
  });
}

export async function receivePoAction(id: number, receipts: { lineId: number; quantity: number }[], note: string | null): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const user = await requirePermission("inventory.edit");
    const clean = z.array(z.object({ lineId: z.number().int().positive(), quantity: z.number().min(0).max(100_000_000) })).max(200).parse(receipts);
    const r = await db.transaction((tx) => receivePurchaseOrder(tx, user.tenantId, id, clean.map((x) => ({ ...x, quantity: roundQty(x.quantity) })), user, note?.slice(0, 500) || null));
    revalidatePo(id);
    return r;
  }, "Received");
}

export async function cancelPoAction(id: number, reason: string | null): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("purchasing.edit");
    await db.transaction((tx) => cancelPurchaseOrder(tx, user.tenantId, id, reason?.trim().slice(0, 300) || null, user));
    revalidatePo(id);
  }, "Purchase order cancelled");
}

export async function createSuggestedDraftsAction(vendorIds: number[]): Promise<ActionResult<{ created: { id: number; number: number }[] }>> {
  return runAction(async () => {
    const user = await requirePermission("purchasing.edit");
    const ids = z.array(z.number().int().positive()).min(1).max(100).parse(vendorIds);
    const created = await db.transaction((tx) => createSuggestedDrafts(tx, user.tenantId, ids, user));
    if (!created.length) throw new UserError("Nothing needs ordering from that vendor right now.");
    revalidatePo();
    return { created };
  });
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

export async function saveVendorAction(_prev: Prev, fd: FormData): Promise<ActionResult<{ id: number; name: string }>> {
  return runAction(async () => {
    const user = await requirePermission("purchasing.edit");
    const v = {
      name: str(fd, "name")?.slice(0, 120) ?? "",
      contactName: str(fd, "contactName")?.slice(0, 120) ?? null,
      email: str(fd, "email")?.slice(0, 200) ?? null,
      phone: str(fd, "phone")?.slice(0, 40) ?? null,
      accountNumber: str(fd, "accountNumber")?.slice(0, 60) ?? null,
      website: str(fd, "website")?.slice(0, 200) ?? null,
      notes: str(fd, "notes")?.slice(0, 2000) ?? null,
    };
    const id = await db.transaction((tx) => saveVendor(tx, user.tenantId, int(fd, "id"), v, user));
    revalidatePath("/inventory/vendors");
    revalidatePath("/inventory/purchase-orders/new");
    return { id, name: v.name };
  }, "Vendor saved");
}
