/** Friendly labels for pricing settings. Safe on client and server. */
import type { FinishingOption, PricingConfig, PricingMethod } from "@/lib/pricing/engine";

export const PRICING_METHOD_LABELS: Record<PricingMethod, string> = {
  per_sqft: "By square foot",
  quantity_tier: "By quantity tiers",
  per_unit: "Per piece",
  custom: "Custom / manual",
};

export const PRICING_METHOD_HINTS: Record<PricingMethod, string> = {
  per_sqft: "Banners, signs, wraps: width × height × a price per square foot.",
  quantity_tier: "Business cards, flyers: one price for 250, another for 500, and so on.",
  per_unit: "Yard signs, banner stands: a set price for each piece.",
  custom: "Every job is different. Someone enters the price by hand.",
};

export const BASIS_LABELS: Record<FinishingOption["basis"], string> = {
  flat: "Flat, once",
  per_unit: "Per piece",
  per_sqft: "Per sq ft",
  per_linear_ft: "Per linear ft",
};

export const GROUP_LABELS: Record<string, string> = {
  print: "Printing",
  sign: "Signs & large format",
  wrap: "Vehicle graphics & wraps",
  design: "Design",
  other: "Other",
};

const $ = (c: number) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;

/** One short line: "$5.50 / sq ft", "250 for $45", "$12 each", "Priced by hand". */
export function priceSummary(config: PricingConfig | null | undefined): string {
  if (!config) return "Not set up";
  switch (config.method) {
    case "per_sqft":
      return config.pricePerSqftCents ? `${$(config.pricePerSqftCents)} / sq ft` : "Price per sq ft not set";
    case "quantity_tier": {
      const t = [...(config.tiers ?? [])].sort((a, b) => a.minQty - b.minQty)[0];
      return t ? `${t.minQty.toLocaleString()} for ${$(t.priceCents)}` : "No tiers yet";
    }
    case "per_unit":
      return config.unitPriceCents ? `${$(config.unitPriceCents)} each` : "Price each not set";
    default:
      return "Priced by hand";
  }
}

/** "Hem & grommets" → "hem-grommets" */
export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
