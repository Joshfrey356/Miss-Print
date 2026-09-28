import "server-only";
import { cache } from "react";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, equipment, materials, operations, pricingRules, productCategories } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";
import { calculatePrice, type PricingConfig, type PricingInput, type PricingResult } from "@/lib/pricing/engine";
import type { PrintCatalog } from "@/lib/pricing/print";

/**
 * A shop's paper stocks, presses and bindery services for the print estimator (active ones only).
 * Paper stocks are materials with a sheet size and a cost per 1,000 sheets.
 */
export const loadPrintCatalog = cache(async (tenantId: number): Promise<PrintCatalog> => {
  const [papers, presses, ops] = await Promise.all([
    db
      .select()
      .from(materials)
      .where(and(eq(materials.tenantId, tenantId), eq(materials.active, true), isNotNull(materials.sheetWidthIn), isNotNull(materials.sheetHeightIn), isNotNull(materials.costPerMCents)))
      .orderBy(asc(materials.name)),
    db
      .select()
      .from(equipment)
      .where(and(eq(equipment.tenantId, tenantId), eq(equipment.active, true)))
      .orderBy(asc(equipment.sortOrder), asc(equipment.name)),
    db
      .select()
      .from(operations)
      .where(and(eq(operations.tenantId, tenantId), eq(operations.active, true)))
      .orderBy(asc(operations.sortOrder), asc(operations.name)),
  ]);
  return {
    papers: papers.map((m) => ({ id: m.id, name: m.name, sheetWidthIn: m.sheetWidthIn!, sheetHeightIn: m.sheetHeightIn!, costPerMCents: m.costPerMCents!, markupPct: m.markupPct })),
    presses: presses
      .filter((p): p is typeof p & { kind: "digital" | "offset" } => p.kind === "digital" || p.kind === "offset")
      .map(({ tenantId: _t, locationId: _l, notes: _n, sortOrder: _s, active: _a, ...p }) => p),
    operations: ops.map((o) => ({
      id: o.id,
      name: o.name,
      basis: o.basis,
      setupPriceCents: o.setupPriceCents,
      setupCostCents: o.setupCostCents,
      ratePriceCents: o.ratePriceCents,
      rateCostCents: o.rateCostCents,
      piecesPerHour: o.piecesPerHour,
      minimumCents: o.minimumCents,
    })),
  };
});

export type ItemPricingRequest = Omit<PricingInput, "materialCostCents" | "discountPct"> & {
  categoryId: number | null;
  materialId?: number | null;
  customerId?: number | null;
};

export async function getCategoryConfig(tenantId: number, categoryId: number | null): Promise<PricingConfig> {
  if (!categoryId) return { method: "custom" };
  const [row] = await db
    .select({ config: pricingRules.config, method: productCategories.pricingMethod })
    .from(productCategories)
    .leftJoin(pricingRules, and(eq(pricingRules.categoryId, productCategories.id), eq(pricingRules.tenantId, tenantId)))
    .where(and(eq(productCategories.tenantId, tenantId), eq(productCategories.id, categoryId)));
  return (row?.config as PricingConfig | null) ?? { method: row?.method ?? "custom" };
}

/** Price one line on the server (all costs stay server-side). */
export async function priceItem(tenantId: number, req: ItemPricingRequest): Promise<PricingResult> {
  const [config, { rules }] = await Promise.all([getCategoryConfig(tenantId, req.categoryId), getSettings(tenantId)]);
  let materialCostCents: number | null = null;
  if (req.materialId) {
    const [m] = await db.select({ cost: materials.costCents, unit: materials.unit }).from(materials).where(and(eq(materials.tenantId, tenantId), eq(materials.id, req.materialId)));
    if (m && (config.method !== "per_sqft" || m.unit === "sqft")) materialCostCents = m.cost;
  }
  let discountPct = 0;
  if (req.customerId) {
    const [c] = await db.select({ d: customers.discountPct }).from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, req.customerId)));
    discountPct = c?.d ?? 0;
  }
  const catalog = config.method === "sheet_fed" ? await loadPrintCatalog(tenantId) : undefined;
  return calculatePrice(config, { ...req, materialCostCents, discountPct }, rules, catalog);
}

/** Strip cost/margin details for roles without margins.view. */
export function publicResult(r: PricingResult, showCost: boolean) {
  if (showCost) return r;
  return {
    ...r,
    estimatedCostCents: 0,
    marginPct: null,
    targetPriceCents: null,
    costLines: [],
    warnings: r.warnings.filter((w) => !w.startsWith("Margin")),
    pressOptions: r.pressOptions?.map((o) => ({ ...o, costCents: 0 })),
  };
}
