import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtRate, parseCount, parseInches, parseMoneyCents, parsePct, parseRateCents, parseSize, rateToInput } from "../src/lib/estimating/parse";
import { getter, operationExample, sheetPrices, validateEquipment, validateOperation, validatePaper } from "../src/lib/estimating/catalog-forms";
import { insertStarterPrintCatalog, starterPrintCategories } from "../src/lib/estimating/starter-catalog";
import { cleanPricingConfig } from "../src/lib/admin/pricing-schema";
import { calculatePrice, DEFAULT_BUSINESS_RULES as R } from "../src/lib/pricing/engine";
import type { PrintCatalog } from "../src/lib/pricing/print";

test("rates below a cent: 4.5¢, $0.045, plain dollars", () => {
  assert.equal(parseRateCents("4.5¢"), 4.5);
  assert.equal(parseRateCents("4.5c"), 4.5);
  assert.equal(parseRateCents("4.5 cents"), 4.5);
  assert.equal(parseRateCents("$0.045"), 4.5);
  assert.equal(parseRateCents("0.045"), 4.5);
  assert.equal(parseRateCents(".30"), 30);
  assert.equal(parseRateCents("$1.25"), 125);
  assert.equal(parseRateCents("1¢"), 1);
  assert.equal(parseRateCents("$0.0455"), 4.55);
  assert.equal(parseRateCents(""), null);
  assert.equal(parseRateCents(null), null);
  assert.ok(Number.isNaN(parseRateCents("about a nickel")));
  assert.ok(Number.isNaN(parseRateCents("$1.2.3")));
  assert.equal(fmtRate(4.5), "4.5¢");
  assert.equal(fmtRate(30), "$0.30");
  assert.equal(fmtRate(125), "$1.25");
  assert.equal(rateToInput(4.5), "0.045");
  assert.equal(rateToInput(30), "0.30");
  assert.equal(rateToInput(1250), "12.50");
  assert.equal(rateToInput(null), "");
  // round trip
  for (const c of [4.5, 0.25, 30, 8, 1.2345, 12500]) assert.equal(parseRateCents(rateToInput(c)), c);
});

test("percentages, money, counts", () => {
  assert.equal(parsePct("25%"), 0.25);
  assert.equal(parsePct("25"), 0.25);
  assert.equal(parsePct(" 2.5 % "), 0.025);
  assert.equal(parsePct(""), null);
  assert.ok(Number.isNaN(parsePct("lots")));
  assert.equal(parseMoneyCents("$1,250.50"), 125050);
  assert.equal(parseMoneyCents("80"), 8000);
  assert.ok(Number.isNaN(parseMoneyCents("eighty")));
  assert.equal(parseCount("6,000"), 6000);
  assert.ok(Number.isNaN(parseCount("6.5")));
});

test("inches and sheet sizes", () => {
  assert.equal(parseInches("12"), 12);
  assert.equal(parseInches('12.5"'), 12.5);
  assert.equal(parseInches("12 1/2"), 12.5);
  assert.equal(parseInches("12-1/2"), 12.5);
  assert.equal(parseInches("1/8"), 0.125);
  assert.equal(parseInches("11/2"), 5.5);
  assert.equal(parseInches("0.375 in"), 0.375);
  assert.equal(parseInches("abc"), null);
  assert.deepEqual(parseSize("12 x 18"), { widthIn: 12, heightIn: 18 });
  assert.deepEqual(parseSize("12×18"), { widthIn: 12, heightIn: 18 });
  assert.deepEqual(parseSize('8.5" X 11"'), { widthIn: 8.5, heightIn: 11 });
  assert.deepEqual(parseSize("8 1/2 x 11"), { widthIn: 8.5, heightIn: 11 });
  assert.deepEqual(parseSize("25 by 38"), { widthIn: 25, heightIn: 38 });
  assert.equal(parseSize("12"), null);
  assert.equal(parseSize("0 x 18"), null);
});

test("paper form: required fields, derived per-sheet price", () => {
  const ok = validatePaper(getter({ name: " 100# Gloss Text 12×18 ", weight: "100# Text", sheetSize: "12 x 18", costPerM: "$80", markupPct: "", vendorId: "", sku: "" }));
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.value, { name: "100# Gloss Text 12×18", weight: "100# Text", sheetWidthIn: 12, sheetHeightIn: 18, costPerMCents: 8000, markupPct: null, vendorId: null, sku: null });
  }
  const bad = validatePaper(getter({ name: "Cover", sheetSize: "12 by", costPerM: "100" }));
  assert.deepEqual(bad, { ok: false, error: "Sheet size should be width x height in inches, like 12 x 18." });
  assert.equal((validatePaper(getter({ name: "Cover", sheetSize: "12x18" })) as { error: string }).error, "Enter the cost per 1,000 sheets.");
  assert.match((validatePaper(getter({ name: "Cover", sheetSize: "12x18", costPerM: "90", markupPct: "2000" })) as { error: string }).error, /more than 1000%/);
  // $80 per 1,000 → 8¢ a sheet; +30% default → 10.4¢; own markup 50% → 12¢
  assert.deepEqual(sheetPrices(8000, null), { costPerSheetCents: 8, pricePerSheetCents: 10.4, markupPct: 0.3 });
  assert.equal(sheetPrices(8000, 0.5).pricePerSheetCents, 12);
});

test("equipment form: digital press with sub-cent clicks", () => {
  const r = validateEquipment(
    getter({
      name: "Konica C4080",
      kind: "digital",
      maxSheet: "13 x 19",
      minSheet: "",
      gripperIn: "0.2",
      colorClickPrice: "$0.30",
      colorClickCost: "4.5¢",
      bwClickPrice: "8¢",
      bwClickCost: "$0.01",
      setupMinutes: "5",
      sheetsPerHour: "3,600",
      hourlyPrice: "60",
      hourlyCost: "35",
      setupSpoilageSheets: "10",
      runSpoilagePct: "2",
      platePrice: "25", // not a digital thing: dropped
    }),
  );
  assert.ok(r.ok, !r.ok ? r.error : "");
  if (!r.ok) return;
  const v = r.value;
  assert.equal(v.colorClickPriceCents, 30);
  assert.equal(v.colorClickCostCents, 4.5);
  assert.equal(v.bwClickPriceCents, 8);
  assert.equal(v.bwClickCostCents, 1);
  assert.equal(v.maxSheetWidthIn, 13);
  assert.equal(v.minSheetWidthIn, null);
  assert.equal(v.gripperIn, 0.2);
  assert.equal(v.sheetsPerHour, 3600);
  assert.equal(v.runSpoilagePct, 0.02);
  assert.equal(v.platePriceCents, null);
  // A click charge in dollars by mistake is caught.
  const oops = validateEquipment(getter({ name: "X", kind: "digital", maxSheet: "13x19", colorClickPrice: "30" }));
  assert.equal(oops.ok, false);
  assert.match((oops as { error: string }).error, /looks too high.*4\.5¢/);
  assert.match((validateEquipment(getter({ name: "X", kind: "digital", maxSheet: "13x19" })) as { error: string }).error, /click charge/);
});

test("equipment form: offset needs speed and an hourly rate; other machines drop press fields", () => {
  const base = { name: "GTO 52", kind: "offset", maxSheet: "14 x 20", maxColors: "4", platePrice: "25", plateCost: "12", inkCostPerM: "3", setupMinutes: "15", hourlyPrice: "110" };
  assert.match((validateEquipment(getter(base)) as { error: string }).error, /sheets an hour/);
  const ok = validateEquipment(getter({ ...base, sheetsPerHour: "6000", perfecting: "on", minSheet: "20 x 14" }));
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.platePriceCents, 2500);
    assert.equal(ok.value.inkCostPerMCents, 300);
    assert.equal(ok.value.perfecting, true);
    assert.equal(ok.value.colorClickPriceCents, null);
  }
  assert.match((validateEquipment(getter({ ...base, sheetsPerHour: "6000", minSheet: "20 x 30" })) as { error: string }).error, /smallest sheet is bigger/);
  const cutter = validateEquipment(getter({ name: "Challenge", kind: "cutter", maxSheet: "13x19", colorClickPrice: "0.30", hourlyPrice: "60" }));
  assert.ok(cutter.ok);
  if (cutter.ok) {
    assert.equal(cutter.value.maxSheetWidthIn, null);
    assert.equal(cutter.value.colorClickPriceCents, null);
    assert.equal(cutter.value.hourlyPriceCents, 6000);
  }
  assert.match((validateEquipment(getter({ name: "X", kind: "laser" })) as { error: string }).error, /what kind/);
});

test("service form and the example line", () => {
  const stitch = validateOperation(getter({ name: "Saddle stitching", category: "bindery", basis: "per_piece", ratePrice: "3.5¢", rateCost: "$0.01", setupPrice: "20", minimum: "30" }));
  assert.ok(stitch.ok);
  if (stitch.ok) {
    assert.equal(stitch.value.ratePriceCents, 3.5);
    assert.equal(stitch.value.rateCostCents, 1);
    assert.equal(stitch.value.piecesPerHour, null);
    // $20 + 2,500 × 3.5¢ = $107.50
    assert.equal(operationExample(stitch.value), "2,500 pieces → $107.50");
  }
  const fold = validateOperation(getter({ name: "Folding", basis: "per_1000", ratePrice: "20", setupPrice: "15", minimum: "25" }));
  assert.ok(fold.ok);
  if (fold.ok) {
    assert.equal(fold.value.ratePriceCents, 2000);
    assert.equal(fold.value.category, "bindery");
    assert.equal(operationExample(fold.value), "2,500 pieces → $65.00"); // $15 + 2.5 × $20
    assert.equal(operationExample({ ...fold.value, minimumCents: 10000 }), "2,500 pieces → $100.00 (minimum)");
  }
  assert.match((validateOperation(getter({ name: "Padding", basis: "per_hour", ratePrice: "40" })) as { error: string }).error, /pieces an hour/);
  const pad = validateOperation(getter({ name: "Padding", basis: "per_hour", ratePrice: "40", piecesPerHour: "1,000" }));
  assert.ok(pad.ok);
  if (pad.ok) assert.equal(operationExample(pad.value), "2,500 pieces (2.5 hr) → $100.00");
  const prep = validateOperation(getter({ name: "File prep", category: "prepress", basis: "per_job", setupPrice: "15", ratePrice: "99" }));
  assert.ok(prep.ok);
  if (prep.ok) {
    assert.equal(prep.value.ratePriceCents, 0);
    assert.equal(operationExample(prep.value), "Any job → $15.00");
  }
  const lam = validateOperation(getter({ name: "Lamination", basis: "per_sheet", ratePrice: "75¢" }));
  assert.ok(lam.ok);
  if (lam.ok) assert.equal(operationExample(lam.value), "500 press sheets → $375.00");
  assert.match((validateOperation(getter({ name: "X", basis: "per_1000" })) as { error: string }).error, /Enter the charge per 1,000/);
});

test("pricing config: sheet_fed keeps the print settings and checks them", () => {
  const c = cleanPricingConfig({ method: "sheet_fed", tiers: [{ minQty: 250, priceCents: 4500 }], print: { paperIds: [1, 2], defaultPaperId: 2, defaultPages: 2, defaultColorsFront: 4, defaultColorsBack: 4, bleedIn: 0.125, defaultBleed: true, paperMarkupPct: 0.3 } });
  assert.equal(c.tiers, undefined);
  assert.deepEqual(c.print, { paperIds: [1, 2], defaultPaperId: 2, defaultPages: 2, defaultColorsFront: 4, defaultColorsBack: 4, bleedIn: 0.125, defaultBleed: true, paperMarkupPct: 0.3 });
  assert.throws(() => cleanPricingConfig({ method: "sheet_fed", print: { paperIds: [1], defaultPaperId: 5 } }), /default paper must be one of/);
  assert.throws(() => cleanPricingConfig({ method: "sheet_fed", print: { defaultPages: 1, defaultColorsBack: 4 } }), /no back/);
  // Switching back drops the print settings.
  assert.equal(cleanPricingConfig({ method: "per_unit", unitPriceCents: 100, print: { defaultPages: 2 } }).print, undefined);
});

/** A fake drizzle insert that hands out ids and remembers every row. */
function fakeDb() {
  const rows: Record<string, Record<string, unknown>[]> = {};
  let next = 1;
  const nameOf = (t: object) => (t as Record<symbol, string>)[Symbol.for("drizzle:Name")] ?? "?";
  return {
    rows,
    insert: (table: object) => ({
      values: (vals: Record<string, unknown>[]) => ({
        returning: async () => {
          const out = vals.map((v) => ({ active: true, markupPct: null, ...v, id: next++ }));
          (rows[nameOf(table)] ??= []).push(...out);
          return out;
        },
      }),
    }),
  };
}

test("starter catalog: a new shop can estimate cards and flyers on day one", async () => {
  const f = fakeDb();
  const cat = await insertStarterPrintCatalog(f, 7, { paperVendorId: 3, locationId: 1 });
  const papers = f.rows["materials"]!;
  assert.ok(papers.length >= 10);
  assert.ok(papers.every((p) => p.tenantId === 7 && p.kind === "paper" && p.unit === "sheet" && (p.costPerMCents as number) > 0 && p.vendorId === 3));
  assert.equal(f.rows["equipment"]!.length, 4);
  assert.ok(f.rows["operations"]!.every((o) => o.tenantId === 7));

  const catalog: PrintCatalog = {
    papers: papers.map((p) => ({ id: p.id as number, name: p.name as string, sheetWidthIn: p.sheetWidthIn as number, sheetHeightIn: p.sheetHeightIn as number, costPerMCents: p.costPerMCents as number, markupPct: null })),
    presses: f.rows["equipment"]!
      .filter((e) => e.kind === "digital" || e.kind === "offset")
      .map((e) => ({
        minSheetWidthIn: null,
        minSheetHeightIn: null,
        perfecting: false,
        colorClickPriceCents: null,
        colorClickCostCents: null,
        bwClickPriceCents: null,
        bwClickCostCents: null,
        platePriceCents: null,
        plateCostCents: null,
        inkCostPerMCents: null,
        sheetsPerHour: null,
        hourlyPriceCents: null,
        hourlyCostCents: null,
        setupSpoilageSheets: 0,
        runSpoilagePct: 0,
        maxSheetWidthIn: null,
        maxSheetHeightIn: null,
        gripperIn: 0.25,
        maxColors: 4,
        setupMinutes: 0,
        ...e,
      })) as PrintCatalog["presses"],
    operations: f.rows["operations"]!.map((o) => ({ setupPriceCents: 0, setupCostCents: 0, ratePriceCents: 0, rateCostCents: 0, piecesPerHour: null, minimumCents: 0, ...o })) as PrintCatalog["operations"],
  };
  const cats = starterPrintCategories(cat);
  for (const slug of ["business-cards", "flyers", "brochures", "postcards-mailers", "letterhead"]) {
    const c = cats[slug]!;
    assert.equal(cleanPricingConfig(c.config).method, "sheet_fed", slug); // valid as saved
  }

  // 500 business cards, 14pt, 4/4 with bleed: 21 up on 12×18 → 24 sheets + 10 + 1 spoilage = 35.
  const cardsCfg = cats["business-cards"]!.config;
  // The quote builder sends the category's default services pre-ticked.
  const cards = calculatePrice(cardsCfg, { quantity: 500, widthIn: 3.5, heightIn: 2, print: { pages: 2, colorsFront: 4, colorsBack: 4, bleed: true, paperId: null, pressId: null, operationIds: cardsCfg.print!.defaultOperationIds! } }, R, catalog);
  assert.equal(cards.production?.pressName, "Digital color press");
  assert.equal(cards.production?.ups, 21);
  assert.equal(cards.production?.pressSheets, 35);
  // Paper 35 × $200/M = $7.00 + 30% = $9.10; clicks 70 × $0.30 = $21; setup 5 min × $60/hr = $5; cutting $15 + 0.5 × $4 = $17.
  assert.equal(cards.recommendedCents, 910 + 2100 + 500 + 1700);

  // Flyers: short runs go digital, long runs go offset.
  const flyerCfg = cats["flyers"]!.config;
  const flyer = (quantity: number) => calculatePrice(flyerCfg, { quantity, widthIn: 8.5, heightIn: 11, print: { pages: 1, colorsFront: 4, colorsBack: 0, bleed: false, paperId: null, pressId: null, operationIds: flyerCfg.print!.defaultOperationIds! } }, R, catalog);
  const short = flyer(1000);
  assert.equal(short.production?.pressName, "Digital color press");
  assert.ok(short.recommendedCents > 15000 && short.recommendedCents < 30000, `1,000 flyers at ${short.recommendedCents}`);
  const long = flyer(10000);
  assert.equal(long.production?.pressName, "Small offset press (4-color)");
  assert.equal(long.pressOptions?.length, 2);
});
