/** Validation for pricing-rule configs saved from Settings → Pricing. */
import { z } from "zod";
import type { PricingConfig, PricingMethod } from "@/lib/pricing/engine";

const cents = z.number().int().min(0).max(100_000_000);
const pct = (max: number) => z.number().min(0).max(max);
const hours = z.number().min(0).max(1000);

export const pricingConfigSchema = z.object({
  method: z.enum(["per_sqft", "quantity_tier", "per_unit", "custom"]),
  setupCents: cents.optional(),
  pricePerSqftCents: cents.optional(),
  materialCostPerSqftCents: cents.optional(),
  unitPriceCents: cents.optional(),
  unitCostCents: cents.optional(),
  tiers: z
    .array(z.object({ minQty: z.number().int().min(1, "Each tier needs a quantity of at least 1."), priceCents: cents, costCents: cents.optional() }))
    .max(50)
    .optional(),
  materialMarkupPct: pct(10).optional(),
  wastePct: pct(2).optional(),
  machineHours: hours.optional(),
  machineCostPerHourCents: cents.optional(),
  finishingOptions: z
    .array(
      z.object({
        key: z.string().min(1).max(60),
        label: z.string().min(1, "Every finishing option needs a name.").max(120),
        basis: z.enum(["flat", "per_unit", "per_sqft", "per_linear_ft"]),
        priceCents: cents,
        costCents: cents.optional(),
      }),
    )
    .max(50)
    .optional(),
  designHours: hours.optional(),
  installHours: hours.optional(),
  minimumCents: cents.optional(),
  targetMarginPct: pct(0.95).optional(),
  rushPct: pct(3).optional(),
});

const METHOD_FIELDS: Record<PricingMethod, (keyof PricingConfig)[]> = {
  per_sqft: ["pricePerSqftCents", "materialCostPerSqftCents", "materialMarkupPct"],
  quantity_tier: ["tiers"],
  per_unit: ["unitPriceCents", "unitCostCents"],
  custom: [],
};
const ALL_METHOD_FIELDS = new Set(Object.values(METHOD_FIELDS).flat());

/** Validate and drop fields that don't apply to the chosen method, so the saved recipe stays tidy. */
export function cleanPricingConfig(input: unknown): PricingConfig {
  const parsed = pricingConfigSchema.parse(input);
  const keep = new Set(METHOD_FIELDS[parsed.method]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v === undefined) continue;
    if (ALL_METHOD_FIELDS.has(k as keyof PricingConfig) && !keep.has(k as keyof PricingConfig)) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  if (out.tiers) {
    const tiers = (out.tiers as { minQty: number }[]).sort((a, b) => a.minQty - b.minQty);
    if (new Set(tiers.map((t) => t.minQty)).size !== tiers.length) throw new z.ZodError([{ code: "custom", message: "Two quantity tiers have the same quantity.", path: ["tiers"], input: tiers }]);
  }
  if (out.finishingOptions) {
    const keys = (out.finishingOptions as { key: string }[]).map((o) => o.key);
    if (new Set(keys).size !== keys.length) throw new z.ZodError([{ code: "custom", message: "Two finishing options have the same name.", path: ["finishingOptions"], input: keys }]);
  }
  return out as PricingConfig;
}
