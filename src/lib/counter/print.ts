/**
 * Printed items at the counter (categories priced by the print estimator, method "sheet_fed").
 * The counter asks only for size, quantity, sides and paper; everything else (ink colors, bleed,
 * services, best-priced press) comes from the category's defaults, as a new quote line would.
 * Pure: safe on the client and the server.
 */
import type { PrintConfig, PrintProduction } from "@/lib/pricing/print";
import { colorsForSides, type PrintInputs } from "@/lib/quotes/print-options";

export const PRINT_SIZES = [
  { label: "Business card", w: 3.5, h: 2 },
  { label: "Postcard", w: 6, h: 4 },
  { label: "Half letter", w: 5.5, h: 8.5 },
  { label: "Letter", w: 8.5, h: 11 },
  { label: "Tabloid", w: 11, h: 17 },
] as const;

export const PRINT_QUANTITIES = [100, 250, 500, 1000, 2500, 5000];

/** What the counter's item dialog offers for a print category (names only, no costs). */
export type CounterPrintOptions = { papers: { id: number; name: string }[]; defaultPaperId: number | null; defaultPages: 1 | 2 };

export function counterPrintOptions(pc: PrintConfig, papers: { id: number; name: string }[]): CounterPrintOptions {
  const allowed = pc.paperIds?.length ? papers.filter((p) => pc.paperIds!.includes(p.id)) : papers;
  const def = allowed.find((p) => p.id === pc.defaultPaperId) ?? allowed[0];
  return { papers: allowed.map((p) => ({ id: p.id, name: p.name })), defaultPaperId: def?.id ?? null, defaultPages: (pc.defaultPages ?? 1) >= 2 ? 2 : 1 };
}

/** The full print choices for pricing: sides and paper from the counter, the rest from the category. */
export function counterPrintInput(pc: PrintConfig, choice: { pages: 1 | 2; paperId: number | null }): PrintInputs {
  const { front, back } = colorsForSides(choice.pages, pc.defaultColorsFront ?? 4, pc.defaultColorsBack ?? 0);
  return {
    pages: choice.pages,
    colorsFront: front,
    colorsBack: back,
    bleed: pc.defaultBleed ?? false,
    paperId: choice.paperId,
    pressId: null, // best price across the category's presses
    operationIds: pc.defaultOperationIds ?? [],
    servicesChosen: true,
  };
}

/** "21 up · 59 sheets · Konica C4080" */
export const shortProduction = (p: Pick<PrintProduction, "ups" | "pressSheets" | "pressName">) => `${p.ups} up · ${p.pressSheets.toLocaleString("en-US")} sheet${p.pressSheets === 1 ? "" : "s"} · ${p.pressName}`;

const num = (n: number) => String(Number(n.toFixed(3)));
/** "Business Cards — 3.5 × 2, two-sided, 14pt C2S Cover" */
export function printDescription(categoryName: string, w: number | null, h: number | null, pages: number, paperName: string | null) {
  const bits = [w && h ? `${num(w)} × ${num(h)}` : null, pages >= 2 ? "two-sided" : "one-sided", paperName].filter(Boolean);
  return `${categoryName} — ${bits.join(", ")}`;
}
