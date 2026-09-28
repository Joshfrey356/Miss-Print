/**
 * Print estimating in quotes & jobs: the friendly choices shown in the quote builder (sides, ink
 * colors, extra quantities) and the plain-words text for what was estimated (production summary,
 * the job ticket's "How to run it" steps, "250 for $X · 500 for $Y").
 *
 * Pure: safe on the client and the server (and in unit tests).
 */
import type { BreakdownLine } from "@/lib/pricing/engine";
import type { PressOption, PrintProduction } from "@/lib/pricing/print";

/** What the person quoting picks for a sheet-fed line (stored as pricingInput.print). */
export type PrintInputs = {
  /** 1 = one-sided, 2 = two-sided, 3+ = multi-page (every page is one printed side). */
  pages: number;
  colorsFront: number;
  colorsBack: number;
  bleed: boolean;
  paperId: number | null;
  /** Null = best price across the allowed presses. */
  pressId: number | null;
  /** Every service on the job. The category's defaults start ticked and can be removed. */
  operationIds: number[];
  /**
   * True once operationIds is the full list (defaults included). Print choices saved before
   * default services became removable lack it: their defaults were implied (see withDefaultServices).
   */
  servicesChosen?: boolean;
};

/**
 * Print choices with the category's default services made explicit. Choices saved before defaults
 * became removable (no `servicesChosen`) get the defaults added, so their price doesn't change;
 * newer ones are left as the person ticked them.
 */
export function withDefaultServices<T extends { operationIds?: number[]; servicesChosen?: boolean }>(print: T, defaultIds: number[] | undefined): T & { operationIds: number[]; servicesChosen: true } {
  const ops = print.operationIds ?? [];
  return { ...print, operationIds: print.servicesChosen ? ops : [...new Set([...(defaultIds ?? []), ...ops])], servicesChosen: true };
}

/** A priced extra quantity ("Also quote 250 / 500 / 1,000"). */
export type QuantityOption = { quantity: number; recommendedCents: number };

/** How the job runs, plus what the shop floor needs that the estimator doesn't keep. */
export type RunInfo = PrintProduction & {
  pages: number;
  colorsFront: number;
  colorsBack: number;
  bleed: boolean;
  /** Service names: the category's defaults and the ones picked. */
  services: string[];
};

/** What a quote line / job line keeps in pricingBreakdown. */
export type StoredBreakdown = {
  lines?: BreakdownLine[];
  costLines?: BreakdownLine[];
  warnings?: string[];
  production?: RunInfo | null;
  pressOptions?: PressOption[];
  quantityOptions?: QuantityOption[];
};

// ---------------------------------------------------------------------------
// Sides & ink colors
// ---------------------------------------------------------------------------
export type Sides = "one" | "two" | "multi";

export const sidesOf = (pages: number): Sides => (pages <= 1 ? "one" : pages === 2 ? "two" : "multi");

export function sidesLabel(pages: number) {
  const s = sidesOf(pages);
  return s === "one" ? "One-sided" : s === "two" ? "Two-sided" : `${pages} pages`;
}

export type ColorPreset = { key: string; label: string; front: number; back: number };

/** Common ink choices; `back` is ignored for one-sided and multi-page work. */
export const COLOR_PRESETS: Record<Sides, ColorPreset[]> = {
  one: [
    { key: "4/0", label: "Full color (4/0)", front: 4, back: 0 },
    { key: "1/0", label: "Black (1/0)", front: 1, back: 0 },
  ],
  two: [
    { key: "4/4", label: "Full color both sides (4/4)", front: 4, back: 4 },
    { key: "4/1", label: "Color front / black back (4/1)", front: 4, back: 1 },
    { key: "1/1", label: "Black both sides (1/1)", front: 1, back: 1 },
    { key: "4/0", label: "Color front / blank back (4/0)", front: 4, back: 0 },
  ],
  multi: [
    { key: "4", label: "Full color throughout", front: 4, back: 4 },
    { key: "1", label: "Black throughout", front: 1, back: 1 },
  ],
};

/** The preset matching these colors, or "custom". */
export function colorPresetKey(pages: number, front: number, back: number) {
  const s = sidesOf(pages);
  const p = COLOR_PRESETS[s].find((x) => x.front === front && (s !== "two" || x.back === back));
  return p?.key ?? "custom";
}

/** Colors after switching sides: keep what makes sense, e.g. 4/0 → two-sided becomes 4/4. */
export function colorsForSides(pages: number, front: number, back: number): { front: number; back: number } {
  const s = sidesOf(pages);
  const f = front > 0 ? front : 4;
  if (s === "one") return { front: f, back: 0 };
  if (s === "multi") return { front: f, back: f };
  return { front: f, back: back > 0 ? back : f };
}

/** Short colors text for the line, e.g. "4/4", "4/0", "Full color" (multi-page). */
export function colorsShort(pages: number, front: number, back: number) {
  const s = sidesOf(pages);
  if (s === "multi") return front === 4 ? "Full color" : front === 1 ? "Black" : `${front} color`;
  return `${front}/${s === "one" ? 0 : back}`;
}

const inkWord = (c: number) => (c >= 4 ? "full color" : c === 1 ? "black" : c === 0 ? "blank" : `${c} colors`);

/** Plain words for sides + colors, e.g. "Two-sided · 4/1 (full color front, black back)". */
export function printingDescription(pages: number, front: number, back: number) {
  const s = sidesOf(pages);
  if (s === "multi") return `${pages} pages · ${inkWord(front)} throughout`;
  if (s === "one") return `One-sided · ${front}/0 (${inkWord(front)})`;
  if (front === back) return `Two-sided · ${front}/${back} (${inkWord(front)} both sides)`;
  return `Two-sided · ${front}/${back} (${inkWord(front)} front, ${inkWord(back)} back)`;
}

// ---------------------------------------------------------------------------
// Extra quantities
// ---------------------------------------------------------------------------
/** Most extra quantities per line. */
export const MAX_ALT_QUANTITIES = 6;

/**
 * "250, 500, 1,000" / "250 / 500 / 1000" / "2.5k" → [250, 500, 1000].
 * A comma between digit groups ("1,000") is a thousands separator; other commas separate numbers.
 */
export function parseQuantityList(text: string, exclude?: number | null): number[] {
  const out = new Set<number>();
  for (const token of text.split(/[\s;/|]+/)) {
    const raw = token.replace(/^,+|,+$/g, "");
    const parts = /^\d{1,3}(,\d{3})+$/.test(raw) ? [raw.replace(/,/g, "")] : raw.split(",");
    for (const p of parts) {
      const m = p.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)(k|m)?$/);
      if (!m) continue;
      const v = Math.round(Number(m[1]) * (m[2] === "k" ? 1000 : m[2] === "m" ? 1_000_000 : 1));
      if (v > 0 && v <= 10_000_000 && v !== exclude) out.add(v);
    }
  }
  return [...out].sort((a, b) => a - b).slice(0, MAX_ALT_QUANTITIES);
}

export const formatQuantityList = (qtys: number[]) => qtys.map((q) => q.toLocaleString("en-US")).join(", ");

/** The main quantity at its final price and the extra quantities, smallest first. */
export function quantityChoices(mainQty: number, mainCents: number, options: QuantityOption[] | null | undefined) {
  const all = [{ quantity: mainQty, cents: mainCents, main: true }, ...(options ?? []).filter((o) => o.quantity !== mainQty).map((o) => ({ quantity: o.quantity, cents: o.recommendedCents, main: false }))];
  return all.sort((a, b) => a.quantity - b.quantity);
}

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** "250 for $45.00 · 500 for $55.00 · 1,000 for $70.00" (empty when there are no extra quantities). */
export function quantityOptionsText(mainQty: number, mainCents: number, options: QuantityOption[] | null | undefined) {
  if (!options?.some((o) => o.quantity !== mainQty)) return "";
  return quantityChoices(mainQty, mainCents, options)
    .map((c) => `${c.quantity.toLocaleString("en-US")} for ${usd(c.cents)}`)
    .join(" · ");
}

// ---------------------------------------------------------------------------
// Production text
// ---------------------------------------------------------------------------
/** "2 × 2 (turned)" → "2 × 2, turned" (it goes inside parentheses). */
const layoutText = (layout: string) => layout.replace(/\s*\(turned\)$/, ", turned");
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * One line under the quote line, e.g.
 * "Konica C4080 · 14pt C2S Cover 12×18 · 21 up (3 × 7) · 59 sheets incl. 11 spoilage · printed both sides".
 */
export function productionSummary(p: PrintProduction) {
  return [
    p.pressName,
    p.paperName,
    `${p.ups} up (${layoutText(p.layout)})`,
    `${plural(p.pressSheets, "sheet")} incl. ${p.spoilageSheets.toLocaleString("en-US")} spoilage`,
    p.outs > 1 ? `cut ${p.outs} out of ${plural(p.parentSheets, "parent sheet")}` : null,
    p.sidesPrinted === 2 ? "printed both sides" : "printed one side",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The job ticket's "How to run it" steps, in the order the shop floor works. */
export function runSteps(p: RunInfo): { label: string; value: string }[] {
  const steps = [
    { label: "Press", value: p.pressName },
    { label: "Paper", value: p.paperName },
    {
      label: "Cut the paper",
      value: p.outs > 1 ? `${p.parentSheet} parent sheet → cut ${p.outs} out → ${p.pressSheet} press sheets` : `Run the ${p.parentSheet} sheet as is (no cutting before press)`,
    },
    { label: "Layout", value: `${p.ups} up on each sheet (${layoutText(p.layout)})` },
    { label: "Press sheets", value: `${p.netSheets.toLocaleString("en-US")} + ${p.spoilageSheets.toLocaleString("en-US")} spoilage = ${plural(p.pressSheets, "press sheet")}` },
    { label: "Pull from stock", value: `${plural(p.parentSheets, "sheet")} of ${p.paperName}${p.outs > 1 ? ` (${p.parentSheet})` : ""}` },
    { label: "Printing", value: printingDescription(p.pages, p.colorsFront, p.colorsBack) + (p.plates ? ` · ${plural(p.plates, "plate")}` : "") + (p.passes > p.sidesPrinted ? ` · ${p.passes} passes` : "") },
    { label: "Bleed", value: p.bleed ? "Yes — trim to finished size" : "No bleed" },
    { label: "Finishing", value: p.services.length ? p.services.join(", ") : "None" },
  ];
  return steps;
}

// ---------------------------------------------------------------------------
// Who sees what
// ---------------------------------------------------------------------------
/**
 * A stored breakdown trimmed for the viewer: without financials.view only how to run the job
 * (no prices); without margins.view no costs.
 */
export function breakdownForRole(pb: unknown, showMoney: boolean, showCost: boolean): StoredBreakdown | null {
  if (!pb || typeof pb !== "object") return null;
  const b = pb as StoredBreakdown;
  if (!showMoney) return b.production ? { production: b.production } : null;
  if (showCost) return b;
  return {
    lines: b.lines,
    warnings: b.warnings?.filter((w) => !w.startsWith("Margin")),
    production: b.production,
    pressOptions: b.pressOptions?.map((o) => ({ ...o, costCents: 0 })),
    quantityOptions: b.quantityOptions,
  };
}

/** The production info in a stored breakdown, if the line was print-estimated. */
export function runInfoOf(pb: unknown): RunInfo | null {
  const p = pb && typeof pb === "object" ? (pb as StoredBreakdown).production : null;
  return p && typeof p === "object" && typeof p.pressName === "string" ? p : null;
}
