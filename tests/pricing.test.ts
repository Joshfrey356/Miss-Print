import { test } from "node:test";
import assert from "node:assert/strict";
import { calculatePrice, tierPrice, DEFAULT_BUSINESS_RULES as R } from "../src/lib/pricing/engine";

test("banner priced by square foot with grommets and minimum", () => {
  const r = calculatePrice(
    {
      method: "per_sqft",
      pricePerSqftCents: 500,
      materialCostPerSqftCents: 60,
      wastePct: 0.1,
      finishingOptions: [{ key: "hem", label: "Hem & grommets", basis: "per_linear_ft", priceCents: 50 }],
    },
    { quantity: 1, widthIn: 96, heightIn: 48, finishingKeys: ["hem"] },
  );
  // 32 sqft × $5 = $160 ; perimeter 24ft × $0.50 = $12
  assert.equal(r.recommendedCents, 16000 + 1200);
  assert.equal(r.estimatedCostCents, Math.round(32 * 60 * 1.1));
  assert.equal(r.sqftTotal, 32);
});

test("minimum charge is applied", () => {
  const r = calculatePrice({ method: "per_sqft", pricePerSqftCents: 500 }, { quantity: 1, widthIn: 12, heightIn: 12 });
  assert.equal(r.recommendedCents, R.minimumChargeCents);
  assert.ok(r.lines.some((l) => l.label.startsWith("Minimum")));
});

test("quantity tiers: exact, between and below", () => {
  const tiers = [
    { minQty: 250, priceCents: 4500 },
    { minQty: 500, priceCents: 5500 },
    { minQty: 1000, priceCents: 7000 },
  ];
  assert.equal(tierPrice(tiers, 500)!.priceCents, 5500);
  assert.equal(tierPrice(tiers, 100)!.priceCents, 4500);
  assert.equal(tierPrice(tiers, 750)!.priceCents, Math.round((5500 / 500) * 750));
  assert.equal(tierPrice(tiers, 2000)!.priceCents, 14000);
});

test("rush, design, install and discount", () => {
  const r = calculatePrice(
    { method: "per_unit", unitPriceCents: 10000 },
    { quantity: 2, needsDesign: true, designHours: 2, needsInstall: true, installHours: 1, isRush: true, discountPct: 0.1 },
  );
  const base = 20000 + 2 * R.designRateCents + R.installRateCents;
  const rushed = base + Math.round(base * R.rushPct);
  assert.equal(r.recommendedCents, rushed - Math.round(rushed * 0.1));
});

test("warns when below target margin and suggests target price", () => {
  const r = calculatePrice({ method: "per_unit", unitPriceCents: 1000, unitCostCents: 800, targetMarginPct: 0.5 }, { quantity: 10 });
  assert.equal(r.recommendedCents, 10000);
  assert.equal(r.targetPriceCents, 16000);
  assert.ok(r.warnings.length > 0);
});

test("custom category uses manual base", () => {
  const r = calculatePrice({ method: "custom" }, { quantity: 1, customBaseCents: 125000 });
  assert.equal(r.recommendedCents, 125000);
});
