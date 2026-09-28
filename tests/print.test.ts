import { test } from "node:test";
import assert from "node:assert/strict";
import { estimatePrint, estimateOnPress, fitOnSheet, impose, operationCharge, type PaperStock, type Press, type PrintCatalog, type PrintOperation } from "../src/lib/pricing/print";
import { calculatePrice, DEFAULT_BUSINESS_RULES as R } from "../src/lib/pricing/engine";

// Figures below are worked out by hand; see the comments.
const cover14pt: PaperStock = { id: 1, name: "14pt C2S Cover 12×18", sheetWidthIn: 12, sheetHeightIn: 18, costPerMCents: 22000, markupPct: null };
const text70: PaperStock = { id: 2, name: "70# Offset Text 25×38", sheetWidthIn: 25, sheetHeightIn: 38, costPerMCents: 9000, markupPct: null };

const base = { minSheetWidthIn: null, minSheetHeightIn: null, platePriceCents: null, plateCostCents: null, inkCostPerMCents: null, sheetsPerHour: null, hourlyPriceCents: null, hourlyCostCents: null, bwClickPriceCents: 8, bwClickCostCents: 1 };
const digital: Press = {
  ...base,
  id: 10,
  name: "Konica C4080",
  kind: "digital",
  maxSheetWidthIn: 13,
  maxSheetHeightIn: 19,
  gripperIn: 0.25,
  maxColors: 4,
  perfecting: false,
  colorClickPriceCents: 35,
  colorClickCostCents: 4.5,
  setupMinutes: 0,
  setupSpoilageSheets: 10,
  runSpoilagePct: 0.02,
};
const offset: Press = {
  ...base,
  id: 20,
  name: "Heidelberg SM 52",
  kind: "offset",
  maxSheetWidthIn: 20,
  maxSheetHeightIn: 28,
  gripperIn: 0.25,
  maxColors: 4,
  perfecting: false,
  colorClickPriceCents: null,
  colorClickCostCents: null,
  platePriceCents: 2500,
  plateCostCents: 1200,
  inkCostPerMCents: 200,
  setupMinutes: 15,
  sheetsPerHour: 8000,
  hourlyPriceCents: 12000,
  hourlyCostCents: 6000,
  setupSpoilageSheets: 100,
  runSpoilagePct: 0.03,
};
const cutting: PrintOperation = { id: 100, name: "Cutting", basis: "per_job", setupPriceCents: 1500, setupCostCents: 500, ratePriceCents: 0, rateCostCents: 0, piecesPerHour: null, minimumCents: 0 };
const catalog: PrintCatalog = { papers: [cover14pt, text70], presses: [digital, offset], operations: [cutting] };

const cards = { quantity: 1000, finishedWidthIn: 3.5, finishedHeightIn: 2, pages: 2, colorsFront: 4, colorsBack: 4, bleed: true, paperId: 1, pressId: 10, operationIds: [] };

test("business cards with bleed are 21-up on a 12×18 sheet", () => {
  // No bleed: 25-up turned (5 × 5). With 1/8" bleed each card is 3.75 × 2.25 → 3 × 7 = 21.
  assert.equal(fitOnSheet(3.5, 2, 12, 18, 0.25, 0).ups, 25);
  const f = fitOnSheet(3.75, 2.25, 12, 18, 0.25, 0);
  assert.equal(f.ups, 21);
  assert.deepEqual([f.across, f.down, f.rotated], [3, 7, false]);
  const imp = impose(3.75, 2.25, cover14pt, digital, 0)!;
  assert.equal(imp.outs, 1); // the 12×18 sheet goes on the press as is
});

test("digital: 1,000 two-sided color cards", () => {
  const e = estimateOnPress(cards, cover14pt, digital, [cutting]);
  assert.ok(e.ok);
  const p = e.production!;
  // 1000 / 21 → 48 sheets + 10 setup + ceil(48 × 2%) = 1 → 59 press sheets.
  assert.deepEqual([p.ups, p.netSheets, p.spoilageSheets, p.pressSheets, p.parentSheets, p.sidesPrinted, p.impressions], [21, 48, 11, 59, 59, 2, 118]);
  // Paper: 59 × $220/M = $12.98 cost, +30% = $16.87. Clicks: 59 × 35¢ = $20.65 per side.
  assert.deepEqual(
    e.lines.map((l) => l.cents),
    [1687, 2065, 2065],
  );
  assert.equal(e.priceCents, 5817);
  // Cost: 1298 + 2 × round(59 × 4.5¢ = 265.5) = 1298 + 266 + 266
  assert.equal(e.costCents, 1830);
});

test("offset: 5,000 flyers cut from 25×38 parent sheets", () => {
  const e = estimateOnPress({ quantity: 5000, finishedWidthIn: 8.5, finishedHeightIn: 11, pages: 1, colorsFront: 4, colorsBack: 0, bleed: false, paperId: 2, pressId: 20, operationIds: [] }, text70, offset, []);
  assert.ok(e.ok, e.warnings.join());
  const p = e.production!;
  // 25×38 cut in half → 25×19 press sheets (fits the 20×28 press turned), 4-up.
  assert.equal(p.pressSheet, "25 × 19");
  assert.deepEqual([p.outs, p.ups, p.netSheets, p.spoilageSheets, p.pressSheets, p.parentSheets, p.plates, p.passes], [2, 4, 1250, 138, 1388, 694, 4, 1]);
  // Paper 694 × $90/M = $62.46 → +30% $81.20. Plates 4 × $25. Press: make-ready 4 × 15 min = 1 hr
  // + run 1388 / 8000 = 0.1735 hr → 1.1735 × $120 = $140.82. Ink 1388 × 4 / 1000 × $2 = $11.10 → $14.43.
  assert.deepEqual(
    e.lines.map((l) => [l.label, l.cents]),
    [
      ["Paper", 8120],
      ["Plates", 10000],
      ["Press time", 14082],
      ["Ink", 1443],
    ],
  );
  assert.equal(e.priceCents, 33645);
  assert.equal(e.costCents, 6246 + 4800 + 7041 + 1110);
});

test("best price: short runs go digital, long runs go offset", () => {
  const flyer = { finishedWidthIn: 8.5, finishedHeightIn: 11, pages: 1, colorsFront: 4, colorsBack: 0, bleed: false, paperId: 2, pressId: null, operationIds: [] };
  const small = estimatePrint({ ...flyer, quantity: 100 }, catalog);
  assert.equal(small.production!.pressName, "Konica C4080");
  assert.equal(small.options.length, 2);
  assert.ok(small.options[0]!.priceCents <= small.options[1]!.priceCents);
  const big = estimatePrint({ ...flyer, quantity: 5000 }, catalog);
  assert.equal(big.production!.pressName, "Heidelberg SM 52");
  assert.equal(big.priceCents, 33645);
});

test("booklets: 8 pages print on both sides, 4 pages per side", () => {
  const e = estimateOnPress({ quantity: 100, finishedWidthIn: 5.5, finishedHeightIn: 8.5, pages: 8, colorsFront: 4, colorsBack: 0, bleed: false, paperId: 1, pressId: 10, operationIds: [] }, cover14pt, digital, []);
  const p = e.production!;
  // 100 × 8 pages / (4 per side × 2 sides) = 100 sheets + 10 + 2 spoilage.
  assert.deepEqual([p.ups, p.netSheets, p.pressSheets, p.sidesPrinted, p.impressions], [4, 100, 112, 2, 224]);
  assert.equal(e.lines.find((l) => l.label.startsWith("Printing"))!.cents, 224 * 35);
});

test("bindery charges: per 1,000 with a minimum, and by the hour", () => {
  const fold: PrintOperation = { id: 1, name: "Folding", basis: "per_1000", setupPriceCents: 1000, setupCostCents: 0, ratePriceCents: 1500, rateCostCents: 300, piecesPerHour: null, minimumCents: 5000 };
  assert.equal(operationCharge(fold, 2500, 0).priceCents, 5000); // $10 + 2.5 × $15 = $47.50 → minimum $50
  assert.equal(operationCharge(fold, 2500, 0).costCents, 750);
  const pad: PrintOperation = { id: 2, name: "Padding", basis: "per_hour", setupPriceCents: 0, setupCostCents: 0, ratePriceCents: 4000, rateCostCents: 2800, piecesPerHour: 1000, minimumCents: 0 };
  assert.equal(operationCharge(pad, 2500, 0).priceCents, 10000); // 2.5 hr × $40
  const drill: PrintOperation = { id: 3, name: "Drilling", basis: "per_sheet", setupPriceCents: 0, setupCostCents: 0, ratePriceCents: 0.5, rateCostCents: 0.1, piecesPerHour: null, minimumCents: 0 };
  assert.equal(operationCharge(drill, 1000, 59).priceCents, 30); // 59 × ½¢ = 29.5 → 30
});

test("a piece that doesn't fit is reported, not priced", () => {
  const e = estimatePrint({ ...cards, finishedWidthIn: 13, finishedHeightIn: 19, pressId: null }, catalog);
  assert.equal(e.ok, false);
  assert.match(e.warnings[0]!, /doesn't fit/);
  assert.equal(estimatePrint({ ...cards, paperId: 99 }, catalog).warnings[0], "Choose a paper.");
});

test("sheet_fed category: rush and services apply on top of the estimate", () => {
  const r = calculatePrice(
    { method: "sheet_fed", print: { defaultOperationIds: [100] } },
    { quantity: 1000, widthIn: 3.5, heightIn: 2, isRush: true, print: { pages: 2, colorsFront: 4, colorsBack: 4, bleed: true, paperId: 1, pressId: 10, operationIds: [] } },
    R,
    catalog,
  );
  // $58.17 + cutting $15 = $73.17; rush +25% = $18.29 → $91.46
  assert.equal(r.recommendedCents, 7317 + 1829);
  assert.equal(r.estimatedCostCents, 1830 + 500);
  assert.equal(r.production?.ups, 21);
  assert.equal(r.pressOptions?.length, 1);
  // Without a catalog the method can't price.
  assert.match(calculatePrice({ method: "sheet_fed" }, { quantity: 10 }).warnings.join(), /isn't available/);
});
