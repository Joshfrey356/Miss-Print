/**
 * Print estimator for sheet-fed work (digital and offset): business cards, flyers, brochures,
 * letterhead, booklets, forms…
 *
 * Works the way a print shop estimates by hand:
 *   1. Imposition — how many finished pieces fit on a press sheet ("ups"), and how many press
 *      sheets are cut from the parent sheet the paper comes in ("outs").
 *   2. Sheets — net press sheets for the quantity, plus set-up and running spoilage.
 *   3. Paper — parent sheets × cost per 1,000, marked up.
 *   4. Press — digital: a click charge per printed side; offset: plates, make-ready and run time.
 *   5. Bindery & services — cutting, folding, stapling, padding… per job / piece / 1,000 / sheet / hour.
 * With no press chosen it prices every press that can do the job and picks the cheapest ("best price").
 *
 * Pure & deterministic, like engine.ts: safe on the client and the server. Every amount is rounded
 * to whole cents; rates below a cent (clicks) are allowed.
 */

export type PaperStock = {
  id: number;
  name: string;
  sheetWidthIn: number;
  sheetHeightIn: number;
  costPerMCents: number;
  /** Markup on paper cost (0.3 = +30%). Null = the category's default. */
  markupPct: number | null;
};

export type Press = {
  id: number;
  name: string;
  kind: "digital" | "offset";
  maxSheetWidthIn: number | null;
  maxSheetHeightIn: number | null;
  minSheetWidthIn: number | null;
  minSheetHeightIn: number | null;
  gripperIn: number;
  maxColors: number;
  perfecting: boolean;
  colorClickPriceCents: number | null;
  colorClickCostCents: number | null;
  bwClickPriceCents: number | null;
  bwClickCostCents: number | null;
  platePriceCents: number | null;
  plateCostCents: number | null;
  inkCostPerMCents: number | null;
  /** Digital: per job. Offset: per plate (each color on each side). */
  setupMinutes: number;
  sheetsPerHour: number | null;
  hourlyPriceCents: number | null;
  hourlyCostCents: number | null;
  setupSpoilageSheets: number;
  runSpoilagePct: number;
};

export type PrintOperation = {
  id: number;
  name: string;
  basis: "per_job" | "per_piece" | "per_1000" | "per_sheet" | "per_hour";
  setupPriceCents: number;
  setupCostCents: number;
  ratePriceCents: number;
  rateCostCents: number;
  piecesPerHour: number | null;
  minimumCents: number;
};

/** The shop's paper, presses and bindery services, as loaded for the estimator. */
export type PrintCatalog = { papers: PaperStock[]; presses: Press[]; operations: PrintOperation[] };

/** Category settings for sheet-fed work (part of the category's PricingConfig). */
export type PrintConfig = {
  /** Papers offered for this category (empty = all). */
  paperIds?: number[];
  defaultPaperId?: number;
  /** Presses allowed for this category (empty = all digital and offset presses). */
  pressIds?: number[];
  /** Services added to every job in this category, e.g. cutting. */
  defaultOperationIds?: number[];
  defaultPages?: number;
  defaultColorsFront?: number;
  defaultColorsBack?: number;
  /** Does work in this category usually bleed? (pre-ticks "bleed" on new quote lines) */
  defaultBleed?: boolean;
  /** Bleed added on each edge when the design bleeds (default 1/8"). */
  bleedIn?: number;
  /** Space between pieces on the sheet (default 0 without bleed). */
  gutterIn?: number;
  /** Default paper markup when the paper doesn't set its own (default 30%). */
  paperMarkupPct?: number;
};

/** What the person quoting chooses for one line. */
export type PrintSpec = {
  quantity: number;
  finishedWidthIn: number;
  finishedHeightIn: number;
  /**
   * 1 = one-sided flat piece, 2 = two-sided flat piece (front & back),
   * 4, 8, 12… = multi-page document (every page is one printed side).
   */
  pages: number;
  /** Ink colors: 4 = full color, 1 = black/one color, 0 = blank. Multi-page work uses colorsFront throughout. */
  colorsFront: number;
  colorsBack: number;
  bleed: boolean;
  paperId: number | null;
  /** Null = best price across all allowed presses. */
  pressId: number | null;
  operationIds: number[];
};

export type Imposition = {
  /** Finished pieces (or pages) per side of a press sheet. */
  ups: number;
  across: number;
  down: number;
  /** Pieces turned 90° on the sheet. */
  rotated: boolean;
  /** Press sheets cut from each parent sheet. */
  outs: number;
  pressSheetWidthIn: number;
  pressSheetHeightIn: number;
};

export type PrintLine = { label: string; cents: number; detail?: string };

/** What the shop floor needs to know to run the job (shown on the job ticket). */
export type PrintProduction = {
  pressId: number;
  pressName: string;
  paperId: number;
  paperName: string;
  parentSheet: string; // "25 × 38"
  pressSheet: string; // "12.5 × 19"
  outs: number;
  ups: number;
  layout: string; // "3 × 4"
  netSheets: number;
  spoilageSheets: number;
  pressSheets: number;
  parentSheets: number;
  sidesPrinted: 1 | 2;
  passes: number;
  plates: number;
  impressions: number;
  runHours: number;
};

export type PressOption = { pressId: number; pressName: string; priceCents: number; costCents: number };

export type PrintEstimate = {
  ok: boolean;
  priceCents: number;
  costCents: number;
  lines: PrintLine[];
  costLines: PrintLine[];
  warnings: string[];
  production: PrintProduction | null;
  /** Every press that could run the job, cheapest first (for "best price"). */
  options: PressOption[];
};

const round = (n: number) => Math.round(n);
const $ = (c: number) => `$${(c / 100).toFixed(2)}`;
const $rate = (c: number) => (c < 100 && c % 1 !== 0 ? `${c.toFixed(c < 10 ? 2 : 1)}¢` : $(c));
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
const size = (w: number, h: number) => `${num(w)} × ${num(h)}`;

const EPS = 1e-6;

/** How many pieces fit on a sheet, trying both orientations. */
export function fitOnSheet(pieceW: number, pieceH: number, sheetW: number, sheetH: number, marginIn: number, gutterIn: number) {
  const usableW = sheetW - 2 * marginIn;
  const usableH = sheetH - 2 * marginIn;
  const count = (w: number, h: number) => {
    if (w <= 0 || h <= 0 || usableW + EPS < w || usableH + EPS < h) return { across: 0, down: 0 };
    return { across: Math.floor((usableW + gutterIn + EPS) / (w + gutterIn)), down: Math.floor((usableH + gutterIn + EPS) / (h + gutterIn)) };
  };
  const a = count(pieceW, pieceH);
  const b = count(pieceH, pieceW);
  return a.across * a.down >= b.across * b.down ? { ...a, ups: a.across * a.down, rotated: false } : { ...b, ups: b.across * b.down, rotated: true };
}

const fits = (w: number, h: number, maxW: number | null, maxH: number | null) =>
  maxW == null || maxH == null || (w <= maxW + EPS && h <= maxH + EPS) || (h <= maxW + EPS && w <= maxH + EPS);
const bigEnough = (w: number, h: number, minW: number | null, minH: number | null) =>
  minW == null || minH == null || (w + EPS >= minW && h + EPS >= minH) || (h + EPS >= minW && w + EPS >= minH);

/**
 * Best way to cut the parent sheet into press sheets and lay pieces out on them:
 * the most finished pieces per parent sheet, then the fewest cuts.
 */
export function impose(pieceW: number, pieceH: number, paper: Pick<PaperStock, "sheetWidthIn" | "sheetHeightIn">, press: Press, gutterIn: number): Imposition | null {
  let best: Imposition | null = null;
  for (let a = 1; a <= 8; a++) {
    for (let b = 1; b <= 8; b++) {
      const w = paper.sheetWidthIn / a;
      const h = paper.sheetHeightIn / b;
      if (!fits(w, h, press.maxSheetWidthIn, press.maxSheetHeightIn) || !bigEnough(w, h, press.minSheetWidthIn, press.minSheetHeightIn)) continue;
      const f = fitOnSheet(pieceW, pieceH, w, h, press.gripperIn, gutterIn);
      if (!f.ups) continue;
      const outs = a * b;
      const perParent = f.ups * outs;
      const bestPer = best ? best.ups * best.outs : 0;
      if (!best || perParent > bestPer || (perParent === bestPer && outs < best.outs)) {
        best = { ups: f.ups, across: f.across, down: f.down, rotated: f.rotated, outs, pressSheetWidthIn: w, pressSheetHeightIn: h };
      }
    }
  }
  return best;
}

/** Price and cost of one bindery/service operation. */
export function operationCharge(op: PrintOperation, quantity: number, pressSheets: number) {
  let units = 0;
  let detail = "";
  switch (op.basis) {
    case "per_job":
      units = 1;
      break;
    case "per_piece":
      units = quantity;
      detail = `${quantity.toLocaleString("en-US")} × ${$rate(op.ratePriceCents)}`;
      break;
    case "per_1000":
      units = quantity / 1000;
      detail = `${num(units)} M × ${$(op.ratePriceCents)}`;
      break;
    case "per_sheet":
      units = pressSheets;
      detail = `${pressSheets.toLocaleString("en-US")} sheets × ${$rate(op.ratePriceCents)}`;
      break;
    case "per_hour":
      units = op.piecesPerHour ? quantity / op.piecesPerHour : 0;
      detail = `${units.toFixed(2)} hr × ${$(op.ratePriceCents)}`;
      break;
  }
  let price = round(op.setupPriceCents + units * op.ratePriceCents);
  const cost = round(op.setupCostCents + units * op.rateCostCents);
  if (op.setupPriceCents && detail) detail = `setup ${$(op.setupPriceCents)} + ${detail}`;
  if (op.minimumCents && price < op.minimumCents) {
    price = op.minimumCents;
    detail = `minimum ${$(op.minimumCents)}`;
  }
  return { priceCents: price, costCents: cost, detail: detail || undefined };
}

/** Estimate the job on one press. */
export function estimateOnPress(spec: PrintSpec, paper: PaperStock, press: Press, operations: PrintOperation[], config: PrintConfig = {}): PrintEstimate {
  const fail = (msg: string): PrintEstimate => ({ ok: false, priceCents: 0, costCents: 0, lines: [], costLines: [], warnings: [msg], production: null, options: [] });
  const qty = Math.max(0, Math.floor(spec.quantity || 0));
  if (qty <= 0) return fail("Enter a quantity.");
  if (!(spec.finishedWidthIn > 0 && spec.finishedHeightIn > 0)) return fail("Enter the finished size.");
  const pages = Math.max(1, Math.floor(spec.pages || 1));
  const multiPage = pages > 2;
  const colorsFront = Math.max(0, Math.floor(spec.colorsFront));
  const colorsBack = multiPage ? colorsFront : pages === 2 ? Math.max(0, Math.floor(spec.colorsBack)) : 0;
  if (colorsFront === 0 && colorsBack === 0) return fail("Choose the ink colors.");

  const bleed = spec.bleed ? (config.bleedIn ?? 0.125) : 0;
  const gutter = config.gutterIn ?? 0;
  const pieceW = spec.finishedWidthIn + 2 * bleed;
  const pieceH = spec.finishedHeightIn + 2 * bleed;
  const imp = impose(pieceW, pieceH, paper, press, gutter);
  if (!imp) return fail(`${size(spec.finishedWidthIn, spec.finishedHeightIn)} doesn't fit on ${paper.name} on the ${press.name}.`);

  // ---- Sheets ----------------------------------------------------------------
  const sidesPrinted: 1 | 2 = colorsBack > 0 ? 2 : 1;
  // Flat work: each piece is one position on the sheet. Multi-page: each page is a position,
  // both sides of the sheet carry pages.
  const netSheets = multiPage ? Math.ceil((qty * pages) / (imp.ups * 2)) : Math.ceil(qty / imp.ups);
  const colorsPerPass = Math.max(1, press.maxColors);
  const passesPerSide = (c: number) => (c > 0 ? Math.ceil(c / colorsPerPass) : 0);
  const passes = press.kind === "offset" && press.perfecting && sidesPrinted === 2 ? Math.max(passesPerSide(colorsFront), passesPerSide(colorsBack)) : passesPerSide(colorsFront) + passesPerSide(colorsBack);
  const setupSpoilage = press.setupSpoilageSheets * (press.kind === "offset" ? Math.max(1, passes) : 1);
  const runSpoilage = Math.ceil(netSheets * (press.runSpoilagePct || 0));
  const pressSheets = netSheets + setupSpoilage + runSpoilage;
  const parentSheets = Math.ceil(pressSheets / imp.outs);

  const lines: PrintLine[] = [];
  const costLines: PrintLine[] = [];
  const warnings: string[] = [];

  // ---- Paper -----------------------------------------------------------------
  const paperCost = round((parentSheets * paper.costPerMCents) / 1000);
  const markup = paper.markupPct ?? config.paperMarkupPct ?? 0.3;
  lines.push({
    label: "Paper",
    cents: round(paperCost * (1 + markup)),
    detail: `${parentSheets.toLocaleString("en-US")} sheets of ${paper.name}${imp.outs > 1 ? ` (cut ${imp.outs} out)` : ""}`,
  });
  costLines.push({ label: "Paper", cents: paperCost, detail: `${parentSheets.toLocaleString("en-US")} × ${$(paper.costPerMCents)}/M` });

  // ---- Press -----------------------------------------------------------------
  let impressions = 0;
  let runHours = 0;
  let plates = 0;
  if (press.kind === "digital") {
    const side = (colors: number) => {
      const color = colors > 1;
      const priceRate = (color ? press.colorClickPriceCents : press.bwClickPriceCents) ?? 0;
      const costRate = (color ? press.colorClickCostCents : press.bwClickCostCents) ?? 0;
      if (!priceRate) warnings.push(`The ${press.name} has no ${color ? "color" : "black & white"} click charge set.`);
      return { priceRate, costRate, color };
    };
    const faces: { label: string; colors: number }[] = [{ label: "front", colors: colorsFront }];
    if (colorsBack > 0) faces.push({ label: "back", colors: colorsBack });
    if (multiPage) faces.splice(0, faces.length, { label: "both sides", colors: colorsFront });
    for (const f of faces) {
      const s = side(f.colors);
      const count = multiPage ? pressSheets * 2 : pressSheets;
      impressions += count;
      lines.push({ label: `Printing — ${s.color ? "color" : "black"}, ${f.label}`, cents: round(count * s.priceRate), detail: `${count.toLocaleString("en-US")} clicks × ${$rate(s.priceRate)}` });
      costLines.push({ label: `Clicks — ${f.label}`, cents: round(count * s.costRate), detail: `${count.toLocaleString("en-US")} × ${$rate(s.costRate)}` });
    }
    const setupHrs = press.setupMinutes / 60;
    runHours = press.sheetsPerHour ? (pressSheets * Math.max(1, sidesPrinted)) / press.sheetsPerHour : 0;
    if (press.hourlyPriceCents && setupHrs) lines.push({ label: "Press setup", cents: round(setupHrs * press.hourlyPriceCents), detail: `${press.setupMinutes} min` });
    if (press.hourlyCostCents && setupHrs + runHours) costLines.push({ label: "Press time", cents: round((setupHrs + runHours) * press.hourlyCostCents), detail: `${(setupHrs + runHours).toFixed(2)} hr` });
  } else {
    plates = colorsFront + colorsBack;
    if (colorsFront > press.maxColors || colorsBack > press.maxColors) warnings.push(`More colors than the ${press.name} prints in one pass — priced as ${passes} passes.`);
    if (press.platePriceCents || press.plateCostCents) {
      lines.push({ label: "Plates", cents: plates * (press.platePriceCents ?? 0), detail: `${plates} × ${$(press.platePriceCents ?? 0)}` });
      costLines.push({ label: "Plates", cents: plates * (press.plateCostCents ?? 0), detail: `${plates} × ${$(press.plateCostCents ?? 0)}` });
    }
    const makereadyHrs = (press.setupMinutes * plates) / 60;
    runHours = press.sheetsPerHour ? (pressSheets * Math.max(1, passes)) / press.sheetsPerHour : 0;
    if (!press.sheetsPerHour) warnings.push(`The ${press.name} has no run speed set.`);
    if (!press.hourlyPriceCents) warnings.push(`The ${press.name} has no hourly rate set.`);
    const hrs = makereadyHrs + runHours;
    lines.push({
      label: "Press time",
      cents: round(hrs * (press.hourlyPriceCents ?? 0)),
      detail: `make-ready ${makereadyHrs.toFixed(2)} hr + run ${runHours.toFixed(2)} hr × ${$(press.hourlyPriceCents ?? 0)}`,
    });
    costLines.push({ label: "Press time", cents: round(hrs * (press.hourlyCostCents ?? 0)), detail: `${hrs.toFixed(2)} hr` });
    impressions = pressSheets * (colorsFront > 0 ? 1 : 0) + pressSheets * (colorsBack > 0 ? 1 : 0);
    if (press.inkCostPerMCents) {
      const inkUnits = (pressSheets * (colorsFront + colorsBack)) / 1000;
      const ink = round(inkUnits * press.inkCostPerMCents);
      lines.push({ label: "Ink", cents: round(ink * (1 + markup)), detail: `${plates} color${plates === 1 ? "" : "s"}` });
      costLines.push({ label: "Ink", cents: ink });
    }
  }

  // ---- Bindery & services -----------------------------------------------------
  const opIds = [...new Set([...(config.defaultOperationIds ?? []), ...spec.operationIds])];
  for (const id of opIds) {
    const op = operations.find((o) => o.id === id);
    if (!op) continue;
    const c = operationCharge(op, qty, pressSheets);
    lines.push({ label: op.name, cents: c.priceCents, detail: c.detail });
    if (c.costCents) costLines.push({ label: op.name, cents: c.costCents });
  }

  const priceCents = lines.reduce((s, l) => s + l.cents, 0);
  const costCents = costLines.reduce((s, l) => s + l.cents, 0);
  return {
    ok: true,
    priceCents,
    costCents,
    lines,
    costLines,
    warnings,
    options: [],
    production: {
      pressId: press.id,
      pressName: press.name,
      paperId: paper.id,
      paperName: paper.name,
      parentSheet: size(paper.sheetWidthIn, paper.sheetHeightIn),
      pressSheet: size(imp.pressSheetWidthIn, imp.pressSheetHeightIn),
      outs: imp.outs,
      ups: imp.ups,
      layout: `${imp.across} × ${imp.down}${imp.rotated ? " (turned)" : ""}`,
      netSheets,
      spoilageSheets: setupSpoilage + runSpoilage,
      pressSheets,
      parentSheets,
      sidesPrinted,
      passes,
      plates,
      impressions,
      runHours: Math.round(runHours * 100) / 100,
    },
  };
}

/** Presses this category may use. */
export function eligiblePresses(catalog: PrintCatalog, config: PrintConfig = {}) {
  const allowed = config.pressIds?.length ? new Set(config.pressIds) : null;
  return catalog.presses.filter((p) => !allowed || allowed.has(p.id));
}

/**
 * Estimate a sheet-fed job. With a press chosen, prices it there; otherwise prices it on every
 * press that can do it and returns the cheapest, listing the others as options.
 */
export function estimatePrint(spec: PrintSpec, catalog: PrintCatalog, config: PrintConfig = {}): PrintEstimate {
  const paperId = spec.paperId ?? config.defaultPaperId ?? null;
  const paper = catalog.papers.find((p) => p.id === paperId);
  const empty = (msg: string): PrintEstimate => ({ ok: false, priceCents: 0, costCents: 0, lines: [], costLines: [], warnings: [msg], production: null, options: [] });
  if (!paper) return empty(catalog.papers.length ? "Choose a paper." : "Add paper stocks in Settings → Paper & Stock first.");
  const presses = spec.pressId ? catalog.presses.filter((p) => p.id === spec.pressId) : eligiblePresses(catalog, config);
  if (!presses.length) return empty(spec.pressId ? "That press is no longer available." : "Add a press in Settings → Presses & Equipment first.");

  const results = presses.map((p) => ({ press: p, est: estimateOnPress(spec, paper, p, catalog.operations, config) }));
  const good = results.filter((r) => r.est.ok).sort((a, b) => a.est.priceCents - b.est.priceCents || a.est.costCents - b.est.costCents);
  if (!good.length) return results[0]!.est;
  const best = good[0]!.est;
  return { ...best, options: good.map((r) => ({ pressId: r.press.id, pressName: r.press.name, priceCents: r.est.priceCents, costCents: r.est.costCents })) };
}
