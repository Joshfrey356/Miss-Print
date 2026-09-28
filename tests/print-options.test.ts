import { test } from "node:test";
import assert from "node:assert/strict";
import {
  breakdownForRole,
  colorPresetKey,
  colorsForSides,
  colorsShort,
  parseQuantityList,
  printingDescription,
  productionSummary,
  quantityChoices,
  quantityOptionsText,
  runInfoOf,
  runSteps,
  sidesLabel,
  withDefaultServices,
  type RunInfo,
} from "../src/lib/quotes/print-options";
import { estimatePrint, type PrintCatalog } from "../src/lib/pricing/print";

// 1,000 two-sided business cards with bleed on the Konica: 21-up, 48 net + 11 spoilage = 59 sheets.
const catalog: PrintCatalog = {
  papers: [{ id: 1, name: "14pt C2S Cover 12×18", sheetWidthIn: 12, sheetHeightIn: 18, costPerMCents: 22000, markupPct: null }],
  presses: [
    {
      id: 10,
      name: "Konica C4080",
      kind: "digital",
      maxSheetWidthIn: 13,
      maxSheetHeightIn: 19,
      minSheetWidthIn: null,
      minSheetHeightIn: null,
      gripperIn: 0.25,
      maxColors: 4,
      perfecting: false,
      colorClickPriceCents: 35,
      colorClickCostCents: 4.5,
      bwClickPriceCents: 8,
      bwClickCostCents: 1,
      platePriceCents: null,
      plateCostCents: null,
      inkCostPerMCents: null,
      setupMinutes: 0,
      sheetsPerHour: null,
      hourlyPriceCents: null,
      hourlyCostCents: null,
      setupSpoilageSheets: 10,
      runSpoilagePct: 0.02,
    },
  ],
  operations: [],
};
const est = estimatePrint({ quantity: 1000, finishedWidthIn: 3.5, finishedHeightIn: 2, pages: 2, colorsFront: 4, colorsBack: 4, bleed: true, paperId: 1, pressId: null, operationIds: [] }, catalog);
const run: RunInfo = { ...est.production!, pages: 2, colorsFront: 4, colorsBack: 4, bleed: true, services: ["Cutting", "Rounded corners"] };

test("production summary reads like the shop talks", () => {
  assert.equal(productionSummary(est.production!), "Konica C4080 · 14pt C2S Cover 12×18 · 21 up (3 × 7) · 59 sheets incl. 11 spoilage · printed both sides");
  // Cut from a bigger parent sheet: say so.
  assert.equal(
    productionSummary({ ...est.production!, outs: 4, parentSheets: 15, sidesPrinted: 1 }),
    "Konica C4080 · 14pt C2S Cover 12×18 · 21 up (3 × 7) · 59 sheets incl. 11 spoilage · cut 4 out of 15 parent sheets · printed one side",
  );
});

test("run steps: paper, layout, sheets, printing, bleed, finishing", () => {
  const steps = Object.fromEntries(runSteps(run).map((s) => [s.label, s.value]));
  assert.equal(steps["Press"], "Konica C4080");
  assert.equal(steps["Cut the paper"], "Run the 12 × 18 sheet as is (no cutting before press)");
  assert.equal(steps["Layout"], "21 up on each sheet (3 × 7)");
  assert.equal(steps["Press sheets"], "48 + 11 spoilage = 59 press sheets");
  assert.equal(steps["Pull from stock"], "59 sheets of 14pt C2S Cover 12×18");
  assert.equal(steps["Printing"], "Two-sided · 4/4 (full color both sides)");
  assert.equal(steps["Bleed"], "Yes — trim to finished size");
  assert.equal(steps["Finishing"], "Cutting, Rounded corners");
  assert.equal(productionSummary({ ...est.production!, layout: "2 × 2 (turned)", ups: 4 }).split(" · ")[2], "4 up (2 × 2, turned)");
  const cut = Object.fromEntries(runSteps({ ...run, outs: 4, parentSheet: "25 × 38", pressSheet: "12.5 × 19", parentSheets: 15, plates: 8, passes: 4 }).map((s) => [s.label, s.value]));
  assert.equal(cut["Cut the paper"], "25 × 38 parent sheet → cut 4 out → 12.5 × 19 press sheets");
  assert.equal(cut["Pull from stock"], "15 sheets of 14pt C2S Cover 12×18 (25 × 38)");
  assert.equal(cut["Printing"], "Two-sided · 4/4 (full color both sides) · 8 plates · 4 passes");
});

test("sides and color presets", () => {
  assert.equal(sidesLabel(1), "One-sided");
  assert.equal(sidesLabel(2), "Two-sided");
  assert.equal(sidesLabel(16), "16 pages");
  assert.equal(colorPresetKey(2, 4, 1), "4/1");
  assert.equal(colorPresetKey(1, 4, 4), "4/0"); // back doesn't matter one-sided
  assert.equal(colorPresetKey(2, 2, 0), "custom");
  assert.equal(colorPresetKey(16, 1, 1), "1");
  // Switching sides keeps a sensible choice.
  assert.deepEqual(colorsForSides(2, 4, 0), { front: 4, back: 4 });
  assert.deepEqual(colorsForSides(2, 4, 1), { front: 4, back: 1 });
  assert.deepEqual(colorsForSides(1, 4, 4), { front: 4, back: 0 });
  assert.deepEqual(colorsForSides(8, 1, 0), { front: 1, back: 1 });
  assert.equal(colorsShort(1, 4, 4), "4/0");
  assert.equal(colorsShort(2, 4, 1), "4/1");
  assert.equal(colorsShort(12, 4, 4), "Full color");
  assert.equal(printingDescription(2, 4, 1), "Two-sided · 4/1 (full color front, black back)");
  assert.equal(printingDescription(1, 1, 0), "One-sided · 1/0 (black)");
  assert.equal(printingDescription(8, 4, 4), "8 pages · full color throughout");
});

test("extra quantities: parsing", () => {
  assert.deepEqual(parseQuantityList("250, 500, 1,000"), [250, 500, 1000]);
  assert.deepEqual(parseQuantityList("250 / 500 / 1000"), [250, 500, 1000]);
  assert.deepEqual(parseQuantityList("250,500,1000"), [250, 500, 1000]);
  assert.deepEqual(parseQuantityList("2.5k 500 500 x"), [500, 2500]);
  assert.deepEqual(parseQuantityList("500, 1,000, 2,500", 1000), [500, 2500]); // the main quantity isn't an "extra"
  assert.deepEqual(parseQuantityList("1 2 3 4 5 6 7 8"), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(parseQuantityList(""), []);
});

test("extra quantities: what the customer sees", () => {
  const opts = [
    { quantity: 500, recommendedCents: 5500 },
    { quantity: 2500, recommendedCents: 13500 },
  ];
  assert.equal(quantityOptionsText(1000, 7000, opts), "500 for $55.00 · 1,000 for $70.00 · 2,500 for $135.00");
  assert.equal(quantityOptionsText(1000, 7000, []), "");
  assert.equal(quantityOptionsText(1000, 7000, undefined), "");
  assert.deepEqual(
    quantityChoices(1000, 6500, opts).map((c) => [c.quantity, c.cents, c.main]),
    [
      [500, 5500, false],
      [1000, 6500, true], // the final (possibly overridden) price for the main quantity
      [2500, 13500, false],
    ],
  );
});

test("stored breakdown is trimmed for the viewer", () => {
  const pb = {
    lines: [{ label: "Paper", cents: 1234 }],
    costLines: [{ label: "Paper", cents: 900 }],
    warnings: ["Margin 20% is below the 50% target.", "Check the bleed."],
    production: run,
    pressOptions: [{ pressId: 10, pressName: "Konica C4080", priceCents: 5000, costCents: 800 }],
    quantityOptions: [{ quantity: 500, recommendedCents: 5500 }],
  };
  // Production staff: how to run it, nothing with a price.
  const prod = breakdownForRole(pb, false, false)!;
  assert.deepEqual(Object.keys(prod), ["production"]);
  assert.ok(!JSON.stringify(prod).includes("Cents"));
  // Sales (prices, no costs).
  const sales = breakdownForRole(pb, true, false)!;
  assert.equal(sales.costLines, undefined);
  assert.equal(sales.pressOptions![0]!.costCents, 0);
  assert.deepEqual(sales.warnings, ["Check the bleed."]);
  assert.equal(sales.quantityOptions!.length, 1);
  // Owner: everything.
  assert.equal(breakdownForRole(pb, true, true), pb);
  assert.equal(breakdownForRole(null, true, true), null);
  assert.equal(breakdownForRole({ lines: [] }, false, false), null);
  assert.equal(runInfoOf(pb)?.pressName, "Konica C4080");
  assert.equal(runInfoOf({ lines: [] }), null);
});

test("default services: pre-ticked, removable, and implied on older saved quotes", () => {
  // Older saved choices (no servicesChosen): the defaults were implied, so they're added.
  assert.deepEqual(withDefaultServices({ operationIds: [2] }, [1]), { operationIds: [1, 2], servicesChosen: true });
  assert.deepEqual(withDefaultServices({}, [1]), { operationIds: [1], servicesChosen: true });
  // Newer choices list every service: an unticked default stays off.
  assert.deepEqual(withDefaultServices({ operationIds: [2], servicesChosen: true }, [1]), { operationIds: [2], servicesChosen: true });
  // Idempotent.
  const once = withDefaultServices({ operationIds: [3] }, [1, 2]);
  assert.deepEqual(withDefaultServices(once, [1, 2]), once);
});
