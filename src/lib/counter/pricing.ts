import "server-only";
import { getCategoryConfig, loadPrintCatalog, priceItem, type ItemPricingRequest } from "@/lib/pricing/server";
import type { PricingResult } from "@/lib/pricing/engine";
import { priceLine, storedBreakdown } from "@/lib/quotes/pricing";
import type { StoredBreakdown } from "@/lib/quotes/print-options";
import { UserError } from "@/lib/actions";
import { counterPrintInput, counterPrintOptions } from "./print";

export type CounterItemRequest = {
  categoryId: number;
  quantity: number;
  widthIn?: number | null;
  heightIn?: number | null;
  customerId?: number | null;
  /** Print categories (sheet_fed): sides and paper; the rest comes from the category. */
  print?: { pages: 1 | 2; paperId: number | null } | null;
};

export type CounterItemPrice = {
  result: PricingResult;
  /** Print categories: the request as priced (for the job line's pricingInput) and what to keep with it. */
  request: ItemPricingRequest;
  breakdown: StoredBreakdown | null;
  sheetFed: boolean;
};

/** Price one counter line from the shop's price list or, for print categories, the print estimator. */
export async function priceCounterItem(tenantId: number, r: CounterItemRequest): Promise<CounterItemPrice> {
  const config = await getCategoryConfig(tenantId, r.categoryId);
  const base: ItemPricingRequest = { categoryId: r.categoryId, quantity: r.quantity, widthIn: r.widthIn ?? null, heightIn: r.heightIn ?? null, customerId: r.customerId ?? null };
  if (config.method !== "sheet_fed") {
    const result = await priceItem(tenantId, base);
    return { result, request: base, breakdown: null, sheetFed: false };
  }
  if (!(r.widthIn && r.heightIn)) throw new UserError("Enter the finished size.");
  const pc = config.print ?? {};
  const catalog = await loadPrintCatalog(tenantId);
  const opts = counterPrintOptions(pc, catalog.papers);
  // Only the category's papers; anything else falls back to its default paper.
  const paperId = r.print?.paperId && opts.papers.some((p) => p.id === r.print!.paperId) ? r.print.paperId : opts.defaultPaperId;
  const print = counterPrintInput(pc, { pages: r.print?.pages ?? opts.defaultPages, paperId });
  const p = await priceLine(tenantId, { ...base, print });
  return { result: p.result, request: p.req, breakdown: storedBreakdown(p), sheetFed: true };
}
