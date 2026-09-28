import "server-only";
import { and, asc, desc, eq, isNotNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { equipment, locations, materials, operations, vendors } from "@/lib/db/schema";

/**
 * The estimating catalog as shown in Settings (active AND turned-off rows, with names of what they
 * point at). The estimator itself reads only active rows via loadPrintCatalog() in src/lib/pricing/server.ts.
 */

/** Paper stocks: materials with a sheet size, plus paper sold by the sheet that still needs one. */
export async function listPaperStocks(tenantId: number) {
  return db
    .select({
      id: materials.id,
      name: materials.name,
      weight: materials.weight,
      sheetWidthIn: materials.sheetWidthIn,
      sheetHeightIn: materials.sheetHeightIn,
      costPerMCents: materials.costPerMCents,
      markupPct: materials.markupPct,
      vendorId: materials.vendorId,
      vendorName: vendors.name,
      sku: materials.sku,
      active: materials.active,
    })
    .from(materials)
    .leftJoin(vendors, and(eq(vendors.tenantId, materials.tenantId), eq(vendors.id, materials.vendorId)))
    .where(and(eq(materials.tenantId, tenantId), or(isNotNull(materials.sheetWidthIn), and(eq(materials.kind, "paper"), eq(materials.unit, "sheet")))))
    .orderBy(desc(materials.active), asc(materials.name));
}
export type PaperRow = Awaited<ReturnType<typeof listPaperStocks>>[number];

export async function listVendors(tenantId: number) {
  return db
    .select({ id: vendors.id, name: vendors.name, archivedAt: vendors.archivedAt })
    .from(vendors)
    .where(eq(vendors.tenantId, tenantId))
    .orderBy(asc(vendors.name));
}

export async function listEquipment(tenantId: number) {
  const rows = await db
    .select({ e: equipment, locationName: locations.name })
    .from(equipment)
    .leftJoin(locations, and(eq(locations.tenantId, equipment.tenantId), eq(locations.id, equipment.locationId)))
    .where(eq(equipment.tenantId, tenantId))
    .orderBy(desc(equipment.active), asc(equipment.sortOrder), asc(equipment.name));
  return rows.map((r) => ({ ...r.e, locationName: r.locationName }));
}
export type EquipmentRow = Awaited<ReturnType<typeof listEquipment>>[number];

export async function listOperations(tenantId: number) {
  const rows = await db
    .select({ o: operations, equipmentName: equipment.name })
    .from(operations)
    .leftJoin(equipment, and(eq(equipment.tenantId, operations.tenantId), eq(equipment.id, operations.equipmentId)))
    .where(eq(operations.tenantId, tenantId))
    .orderBy(desc(operations.active), asc(operations.sortOrder), asc(operations.name));
  return rows.map((r) => ({ ...r.o, equipmentName: r.equipmentName }));
}
export type OperationRow = Awaited<ReturnType<typeof listOperations>>[number];

/** Check that ids picked in a form belong to this shop. Returns the ids that don't. */
export async function missingIds(tenantId: number, kind: "paper" | "equipment" | "operation", ids: number[]): Promise<number[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const found =
    kind === "paper"
      ? await db.select({ id: materials.id }).from(materials).where(eq(materials.tenantId, tenantId))
      : kind === "equipment"
        ? await db.select({ id: equipment.id }).from(equipment).where(eq(equipment.tenantId, tenantId))
        : await db.select({ id: operations.id }).from(operations).where(eq(operations.tenantId, tenantId));
  const have = new Set(found.map((r) => r.id));
  return unique.filter((i) => !have.has(i));
}
