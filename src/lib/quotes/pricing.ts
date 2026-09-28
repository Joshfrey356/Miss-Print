import "server-only";
import { getCategoryConfig, loadPrintCatalog, priceItem, type ItemPricingRequest } from "@/lib/pricing/server";
import type { PricingResult } from "@/lib/pricing/engine";
import type { PressOption } from "@/lib/pricing/print";
import { withDefaultServices, type QuantityOption, type RunInfo, type StoredBreakdown } from "@/lib/quotes/print-options";

export type LinePricing = {
  /** The request as priced: print choices carry their full service list (see withDefaultServices). */
  req: ItemPricingRequest;
  result: PricingResult;
  /** sheet_fed: how the job runs, with sides/colors/bleed/services for the ticket. */
  production: RunInfo | null;
  /** sheet_fed: every press that can run it, cheapest first (also when one press is chosen). */
  pressOptions: PressOption[] | undefined;
  quantityOptions: QuantityOption[];
};

/**
 * Price one quote line on the server at its quantity and at each extra quantity. For print-estimated
 * (sheet_fed) lines also works out the ticket's run info and the price on every allowed press.
 */
export async function priceLine(tenantId: number, request: ItemPricingRequest, altQuantities: number[] = []): Promise<LinePricing> {
  const config = await getCategoryConfig(tenantId, request.categoryId);
  const pc = config.print ?? {};
  // Sent print choices list every service; older saved ones get the category's defaults added.
  const req: ItemPricingRequest = request.print ? { ...request, print: withDefaultServices(request.print, pc.defaultOperationIds) } : request;
  const alts = altQuantities.filter((q) => q > 0 && q !== req.quantity);
  const [result, compare, ...altResults] = await Promise.all([
    priceItem(tenantId, req),
    // With a press chosen the estimator only prices that press: price "best" too, for the comparison.
    req.print?.pressId ? priceItem(tenantId, { ...req, print: { ...req.print, pressId: null } }) : Promise.resolve(null),
    ...alts.map((quantity) => priceItem(tenantId, { ...req, quantity })),
  ]);
  const quantityOptions = alts.map((quantity, i) => ({ quantity, recommendedCents: altResults[i]!.recommendedCents }));
  let production: RunInfo | null = null;
  if (result.production) {
    const catalog = await loadPrintCatalog(tenantId);
    const pages = Math.max(1, Math.floor(req.print?.pages ?? pc.defaultPages ?? 1));
    const colorsFront = req.print?.colorsFront ?? pc.defaultColorsFront ?? 4;
    const colorsBack = pages > 2 ? colorsFront : pages === 2 ? (req.print?.colorsBack ?? pc.defaultColorsBack ?? 0) : 0;
    // Same rule as the engine: with print choices, exactly the services ticked; without, the defaults.
    const opIds = req.print ? req.print.operationIds : (pc.defaultOperationIds ?? []);
    production = {
      ...result.production,
      pages,
      colorsFront,
      colorsBack,
      bleed: req.print?.bleed ?? pc.defaultBleed ?? false,
      services: opIds.map((id) => catalog.operations.find((o) => o.id === id)?.name).filter((x): x is string => !!x),
    };
  }
  const pressOptions = compare?.pressOptions?.length ? compare.pressOptions : result.pressOptions;
  return { req, result, production, pressOptions, quantityOptions };
}

/** What a line keeps in pricingBreakdown (costs included: trim with breakdownForRole when showing it). */
export function storedBreakdown(p: LinePricing): StoredBreakdown {
  const r = p.result;
  return {
    lines: r.lines,
    costLines: r.costLines,
    warnings: r.warnings,
    ...(p.production ? { production: p.production, pressOptions: p.pressOptions ?? [] } : {}),
    ...(p.quantityOptions.length ? { quantityOptions: p.quantityOptions } : {}),
  };
}
