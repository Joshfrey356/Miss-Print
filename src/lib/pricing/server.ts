import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, materials, pricingRules, productCategories } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";
import { calculatePrice, type PricingConfig, type PricingInput, type PricingResult } from "@/lib/pricing/engine";

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
  return calculatePrice(config, { ...req, materialCostCents, discountPct }, rules);
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
  };
}
