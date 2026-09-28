/**
 * Pricing engine.
 *
 * Produces a RECOMMENDED price with a plain-English breakdown. People always set
 * the FINAL price and may override it. Nothing here is hard-coded per product:
 * every number comes from the category's PricingConfig (editable in Settings →
 * Pricing) and the company business rules.
 *
 * Pure & deterministic — safe on client (live quote preview) and server (saved values).
 */

import { estimatePrint, type PressOption, type PrintCatalog, type PrintConfig, type PrintProduction, type PrintSpec } from "./print";

/** sheet_fed = full print estimating (paper, press, bindery) by src/lib/pricing/print.ts. */
export type PricingMethod = "per_sqft" | "quantity_tier" | "per_unit" | "sheet_fed" | "custom";

export type FinishingOption = {
  key: string; // "grommets"
  label: string; // "Grommets every 2 ft"
  /** How the option is charged */
  basis: "flat" | "per_unit" | "per_sqft" | "per_linear_ft";
  priceCents: number;
  costCents?: number;
};

export type QuantityTier = { minQty: number; priceCents: number; costCents?: number };

export type PricingConfig = {
  method: PricingMethod;
  /** One-time setup/prep charge per line. */
  setupCents?: number;
  /** per_sqft: sell price per square foot (per piece × quantity). */
  pricePerSqftCents?: number;
  /** per_sqft: our material cost per sq ft, used when no specific material is chosen. */
  materialCostPerSqftCents?: number;
  /** per_unit: sell price per piece. */
  unitPriceCents?: number;
  unitCostCents?: number;
  /** quantity_tier: price for the whole quantity at each break (e.g. 250 / 500 / 1000 cards). */
  tiers?: QuantityTier[];
  /** Markup applied on top of a chosen material's cost (0.5 = +50%) when material drives price. */
  materialMarkupPct?: number;
  /** Extra material ordered/wasted (0.1 = 10%). Affects cost only. */
  wastePct?: number;
  /** Machine/production time per job, hours, and our internal cost for it. */
  machineHours?: number;
  machineCostPerHourCents?: number;
  finishingOptions?: FinishingOption[];
  /** Default design hours when design is required. */
  designHours?: number;
  /** Default install hours when installation is required. */
  installHours?: number;
  /** Minimum line charge for this category (falls back to company minimum). */
  minimumCents?: number;
  /** Target gross margin for this category (0.5 = 50%). */
  targetMarginPct?: number;
  /** Rush surcharge for this category (falls back to company rush %). */
  rushPct?: number;
  /** sheet_fed: papers, presses and default services for this category. */
  print?: PrintConfig;
};

/** Company-wide business rules (Settings → Business Rules). */
export type BusinessRules = {
  minimumChargeCents: number;
  designRateCents: number; // per hour, charged
  installRateCents: number; // per hour, charged
  laborCostPerHourCents: number; // internal cost of an hour of labor
  mileageRateCents: number; // per mile, charged
  rushPct: number; // 0.25 = +25%
  targetMarginPct: number; // 0.5 = 50%
  outsourcedMarkupPct: number; // 0.3 = +30% on outside vendor costs
  taxRate: number; // 0.07 = 7%
};

export const DEFAULT_BUSINESS_RULES: BusinessRules = {
  minimumChargeCents: 2500,
  designRateCents: 7500,
  installRateCents: 8500,
  laborCostPerHourCents: 2800,
  mileageRateCents: 150,
  rushPct: 0.25,
  targetMarginPct: 0.5,
  outsourcedMarkupPct: 0.3,
  taxRate: 0.07,
};

export type PricingInput = {
  quantity: number;
  widthIn?: number | null;
  heightIn?: number | null;
  /** Selected material cost per unit (sqft for per_sqft); overrides config cost. */
  materialCostCents?: number | null;
  materialUnit?: string | null;
  finishingKeys?: string[];
  needsDesign?: boolean;
  designHours?: number | null;
  needsInstall?: boolean;
  installHours?: number | null;
  miles?: number | null;
  outsourcedCostCents?: number | null;
  isRush?: boolean;
  /** Customer discount (0.1 = 10% off). */
  discountPct?: number | null;
  /** Manual base price for "custom" categories. */
  customBaseCents?: number | null;
  /** sheet_fed: paper, press, sides/pages, colors, bleed and services. Size & quantity come from above. */
  print?: Omit<PrintSpec, "quantity" | "finishedWidthIn" | "finishedHeightIn"> | null;
};

export type BreakdownLine = { label: string; cents: number; detail?: string };

export type PricingResult = {
  recommendedCents: number;
  estimatedCostCents: number;
  /** Gross margin of the recommended price. */
  marginPct: number | null;
  targetMarginPct: number;
  /** Price that would hit the target margin, when recommendation falls short. */
  targetPriceCents: number | null;
  lines: BreakdownLine[];
  costLines: BreakdownLine[];
  warnings: string[];
  sqftTotal: number;
  /** sheet_fed: how the job runs (press, sheets, layout) — for the job ticket. */
  production?: PrintProduction | null;
  /** sheet_fed: every press that can run it, cheapest first. */
  pressOptions?: PressOption[];
};

const round = (n: number) => Math.round(n);
const $ = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Pick the tier price for a quantity; beyond the top tier, scale per piece. */
export function tierPrice(tiers: QuantityTier[], qty: number): { priceCents: number; costCents: number; note: string } | null {
  const sorted = [...tiers].filter((t) => t.minQty > 0).sort((a, b) => a.minQty - b.minQty);
  if (!sorted.length || qty <= 0) return null;
  // Exact or highest tier at/below quantity
  let tier = sorted[0]!;
  for (const t of sorted) if (t.minQty <= qty) tier = t;
  if (qty === tier.minQty) {
    return { priceCents: tier.priceCents, costCents: tier.costCents ?? 0, note: `${tier.minQty} tier` };
  }
  if (qty < sorted[0]!.minQty) {
    // Below the smallest tier: charge the smallest tier (common print-shop practice).
    return { priceCents: sorted[0]!.priceCents, costCents: sorted[0]!.costCents ?? 0, note: `minimum ${sorted[0]!.minQty} tier` };
  }
  // Between/above tiers: per-piece rate of the tier at/below qty.
  const unit = tier.priceCents / tier.minQty;
  const unitCost = (tier.costCents ?? 0) / tier.minQty;
  return {
    priceCents: round(unit * qty),
    costCents: round(unitCost * qty),
    note: `${tier.minQty}+ rate × ${qty}`,
  };
}

export function calculatePrice(
  config: PricingConfig,
  input: PricingInput,
  rules: BusinessRules = DEFAULT_BUSINESS_RULES,
  /** Paper, presses and services — needed for sheet_fed categories. */
  catalog?: PrintCatalog,
): PricingResult {
  const lines: BreakdownLine[] = [];
  const costLines: BreakdownLine[] = [];
  const warnings: string[] = [];
  const qty = Math.max(0, Math.floor(input.quantity || 0));
  const w = input.widthIn ?? 0;
  const h = input.heightIn ?? 0;
  const sqftEach = w > 0 && h > 0 ? (w * h) / 144 : 0;
  const sqftTotal = sqftEach * qty;
  const waste = config.wastePct ?? 0;
  let production: PrintProduction | null = null;
  let pressOptions: PressOption[] | undefined;

  if (qty <= 0) warnings.push("Enter a quantity.");

  // --- Base -----------------------------------------------------------------
  switch (config.method) {
    case "per_sqft": {
      if (!sqftEach) {
        warnings.push("Enter width and height to price by square foot.");
        break;
      }
      const materialCost = input.materialCostCents ?? config.materialCostPerSqftCents ?? 0;
      let rate = config.pricePerSqftCents ?? 0;
      let detail = `${sqftTotal.toFixed(1)} sq ft × ${$(rate)}`;
      // A chosen material with markup can drive the sell rate when it is higher.
      if (input.materialCostCents != null && config.materialMarkupPct != null) {
        const marked = round(input.materialCostCents * (1 + config.materialMarkupPct));
        if (marked > rate) {
          rate = marked;
          detail = `${sqftTotal.toFixed(1)} sq ft × ${$(rate)} (material + ${Math.round(config.materialMarkupPct * 100)}%)`;
        }
      }
      lines.push({ label: "Printing & material", cents: round(sqftTotal * rate), detail });
      costLines.push({
        label: "Material",
        cents: round(sqftTotal * materialCost * (1 + waste)),
        detail: `${sqftTotal.toFixed(1)} sq ft × ${$(materialCost)}${waste ? ` + ${Math.round(waste * 100)}% waste` : ""}`,
      });
      break;
    }
    case "quantity_tier": {
      const t = tierPrice(config.tiers ?? [], qty);
      if (!t) {
        warnings.push("No quantity tiers are set up for this category.");
        break;
      }
      lines.push({ label: "Printing", cents: t.priceCents, detail: t.note });
      if (t.costCents) costLines.push({ label: "Paper, ink & press", cents: round(t.costCents * (1 + waste)), detail: t.note });
      break;
    }
    case "per_unit": {
      const unit = config.unitPriceCents ?? 0;
      lines.push({ label: "Units", cents: unit * qty, detail: `${qty} × ${$(unit)}` });
      const unitCost = input.materialCostCents ?? config.unitCostCents ?? 0;
      if (unitCost) costLines.push({ label: "Material", cents: round(unitCost * qty * (1 + waste)), detail: `${qty} × ${$(unitCost)}` });
      break;
    }
    case "sheet_fed": {
      if (!catalog) {
        warnings.push("Print estimating isn't available here.");
        break;
      }
      const pc = config.print ?? {};
      const est = estimatePrint(
        {
          quantity: qty,
          finishedWidthIn: w,
          finishedHeightIn: h,
          pages: input.print?.pages ?? pc.defaultPages ?? 1,
          colorsFront: input.print?.colorsFront ?? pc.defaultColorsFront ?? 4,
          colorsBack: input.print?.colorsBack ?? pc.defaultColorsBack ?? 0,
          bleed: input.print?.bleed ?? false,
          paperId: input.print?.paperId ?? null,
          pressId: input.print?.pressId ?? null,
          operationIds: input.print?.operationIds ?? [],
        },
        catalog,
        pc,
      );
      lines.push(...est.lines);
      costLines.push(...est.costLines);
      warnings.push(...est.warnings);
      production = est.production;
      pressOptions = est.options;
      break;
    }
    case "custom": {
      if (input.customBaseCents) lines.push({ label: "Base price", cents: input.customBaseCents, detail: "entered manually" });
      else warnings.push("Custom job — enter a base price or set the final price directly.");
      break;
    }
  }

  if (config.setupCents) lines.push({ label: "Setup", cents: config.setupCents });

  if (config.machineHours && config.machineCostPerHourCents) {
    costLines.push({
      label: "Machine time",
      cents: round(config.machineHours * config.machineCostPerHourCents),
      detail: `${config.machineHours} hr × ${$(config.machineCostPerHourCents)}`,
    });
  }

  // --- Finishing ------------------------------------------------------------
  const perimeterFtEach = w > 0 && h > 0 ? (2 * (w + h)) / 12 : 0;
  for (const key of input.finishingKeys ?? []) {
    const opt = config.finishingOptions?.find((o) => o.key === key);
    if (!opt) continue;
    const units =
      opt.basis === "flat" ? 1 : opt.basis === "per_unit" ? qty : opt.basis === "per_sqft" ? sqftTotal : perimeterFtEach * qty;
    const detail = opt.basis === "flat" ? undefined : `${units.toFixed(opt.basis === "per_unit" ? 0 : 1)} × ${$(opt.priceCents)}`;
    lines.push({ label: opt.label, cents: round(units * opt.priceCents), detail });
    if (opt.costCents) costLines.push({ label: opt.label, cents: round(units * opt.costCents) });
  }

  // --- Design / install / travel / outsourced --------------------------------
  if (input.needsDesign) {
    const hrs = input.designHours ?? config.designHours ?? 1;
    lines.push({ label: "Design", cents: round(hrs * rules.designRateCents), detail: `${hrs} hr × ${$(rules.designRateCents)}` });
    costLines.push({ label: "Design labor", cents: round(hrs * rules.laborCostPerHourCents), detail: `${hrs} hr` });
  }
  if (input.needsInstall) {
    const hrs = input.installHours ?? config.installHours ?? 2;
    lines.push({ label: "Installation", cents: round(hrs * rules.installRateCents), detail: `${hrs} hr × ${$(rules.installRateCents)}` });
    costLines.push({ label: "Install labor", cents: round(hrs * rules.laborCostPerHourCents), detail: `${hrs} hr` });
  }
  if (input.miles) {
    lines.push({ label: "Travel", cents: round(input.miles * rules.mileageRateCents), detail: `${input.miles} mi × ${$(rules.mileageRateCents)}` });
  }
  if (input.outsourcedCostCents) {
    lines.push({
      label: "Outside services",
      cents: round(input.outsourcedCostCents * (1 + rules.outsourcedMarkupPct)),
      detail: `${$(input.outsourcedCostCents)} + ${Math.round(rules.outsourcedMarkupPct * 100)}%`,
    });
    costLines.push({ label: "Outside vendor", cents: input.outsourcedCostCents });
  }

  let subtotal = lines.reduce((s, l) => s + l.cents, 0);

  // --- Rush, discount, minimum -----------------------------------------------
  if (input.isRush && subtotal > 0) {
    const rushPct = config.rushPct ?? rules.rushPct;
    const c = round(subtotal * rushPct);
    lines.push({ label: "Rush", cents: c, detail: `+${Math.round(rushPct * 100)}%` });
    subtotal += c;
  }
  if (input.discountPct && subtotal > 0) {
    const c = -round(subtotal * input.discountPct);
    lines.push({ label: "Customer discount", cents: c, detail: `−${Math.round(input.discountPct * 100)}%` });
    subtotal += c;
  }
  const minimum = config.minimumCents ?? rules.minimumChargeCents;
  if (subtotal > 0 && subtotal < minimum) {
    lines.push({ label: "Minimum charge adjustment", cents: minimum - subtotal, detail: `minimum ${$(minimum)}` });
    subtotal = minimum;
  }

  const cost = costLines.reduce((s, l) => s + l.cents, 0);
  const target = config.targetMarginPct ?? rules.targetMarginPct;
  const margin = subtotal > 0 ? (subtotal - cost) / subtotal : null;
  let targetPrice: number | null = null;
  if (cost > 0 && margin != null && margin < target && target < 1) {
    targetPrice = round(cost / (1 - target));
    warnings.push(`Margin ${Math.round(margin * 100)}% is below the ${Math.round(target * 100)}% target. ${$(targetPrice)} would hit the target.`);
  }

  return {
    recommendedCents: Math.max(0, subtotal),
    estimatedCostCents: cost,
    marginPct: margin,
    targetMarginPct: target,
    targetPriceCents: targetPrice,
    lines,
    costLines,
    warnings,
    sqftTotal,
    ...(config.method === "sheet_fed" ? { production, pressOptions } : {}),
  };
}

/** Gross margin helper used across the app. */
export function marginOf(revenueCents: number, costCents: number): number | null {
  return revenueCents > 0 ? (revenueCents - costCents) / revenueCents : null;
}

/** Sales tax on the taxable portion. */
export function taxFor(taxableCents: number, rate: number, exempt: boolean) {
  return exempt ? 0 : Math.round(taxableCents * rate);
}
