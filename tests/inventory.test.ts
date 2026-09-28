import { test } from "node:test";
import assert from "node:assert/strict";
import {
  availableOf,
  fmtDelta,
  fmtQty,
  fmtUnitCost,
  inventoryAttention,
  isBigChange,
  isPoOverdue,
  jobPurchaseCosts,
  lineAmount,
  packRound,
  parseQty,
  parseUnitCost,
  planReservations,
  poStatusAfterReceive,
  poTotals,
  projectedOf,
  qtyWithUnit,
  remainingOf,
  reservationActionFor,
  reservationNeeds,
  sameReservations,
  stockStatus,
  suggestedOrderQty,
  uncoveredOf,
  unitCostOf,
  unitCostToInput,
  type TrackedMaterial,
} from "../src/lib/inventory/math";
import { poEmail } from "../src/lib/inventory/po-text";

const level = (onHand: number, reserved = 0, onOrder = 0, reorderLevel: number | null = null) => ({ onHand, reserved, onOrder, reorderLevel });

test("available, projected and stock status", () => {
  assert.equal(availableOf(level(2500, 265)), 2235);
  assert.equal(projectedOf(level(2500, 265, 5000)), 7235);
  assert.equal(stockStatus(level(2500, 265, 0, 1000)), "ok");
  assert.equal(stockStatus(level(1200, 265, 0, 1000)), "low"); // 935 available ≤ 1000
  assert.equal(stockStatus(level(1000, 0, 0, 1000)), "low"); // at the level counts as low
  assert.equal(stockStatus(level(0, 0, 0, 1000)), "out");
  assert.equal(stockStatus(level(-10)), "out");
  assert.equal(stockStatus(level(300, 500, 5000, 1000)), "short"); // jobs need more than the shelf, even with an order coming
  assert.equal(stockStatus(level(0, 500)), "short"); // short beats out: jobs are waiting on it
  assert.equal(stockStatus(level(5, 0, 0, null)), "ok"); // no reorder level → never "low"
  assert.equal(uncoveredOf(level(300, 500, 100)), 100);
  assert.equal(uncoveredOf(level(300, 500, 5000)), 0);
  // No float noise.
  assert.equal(availableOf(level(0.3, 0.1)), 0.2);
});

test("quantities: parse, format and units", () => {
  assert.equal(parseQty(" 2,500 "), 2500);
  assert.equal(parseQty("12.345"), 12.35);
  assert.equal(parseQty(""), null);
  assert.equal(parseQty("abc"), null);
  assert.equal(fmtQty(2500), "2,500");
  assert.equal(fmtQty(12.5), "12.5");
  assert.equal(fmtQty(-40), "−40");
  assert.equal(fmtDelta(500), "+500");
  assert.equal(fmtDelta(-265), "−265");
  assert.equal(qtyWithUnit(2500, "sheet"), "2,500 sheets");
  assert.equal(qtyWithUnit(1, "sheet"), "1 sheet");
  assert.equal(qtyWithUnit(96, "sqft"), "96 sq ft");
});

test("big changes need a second look", () => {
  assert.equal(isBigChange(2500, { onHand: 2500 }), false);
  assert.equal(isBigChange(25000, { onHand: 2500 }), true); // the classic extra zero
  assert.equal(isBigChange(5000, { onHand: 0, reorderQuantity: 5000 }), false); // a normal order on an empty shelf
  assert.equal(isBigChange(400, { onHand: 0 }), false); // floor of 100 units × 5
  assert.equal(isBigChange(-12000, { onHand: 2000 }), true);
});

test("unit cost: paper per 1,000 sheets, others per unit; parse & show sub-cent costs", () => {
  assert.equal(unitCostOf({ unit: "sheet", costCents: 8, costPerMCents: 8000 }), 8);
  assert.equal(unitCostOf({ unit: "sheet", costCents: 1, costPerMCents: 1200 }), 1.2); // not rounded to 1¢
  assert.equal(unitCostOf({ unit: "sqft", costCents: 55, costPerMCents: null }), 55);
  assert.equal(lineAmount(5000, 1.2), 6000);
  assert.equal(lineAmount(3, 33.3333), 100);
  assert.equal(parseUnitCost("$0.08"), 8);
  assert.equal(parseUnitCost("0.0012"), 0.12);
  assert.equal(parseUnitCost("38"), 3800);
  assert.equal(parseUnitCost("-1"), null);
  assert.equal(unitCostToInput(8), "0.08");
  assert.equal(unitCostToInput(1.2), "0.012");
  assert.equal(unitCostToInput(3800), "38.00");
  assert.equal(fmtUnitCost(8), "8¢");
  assert.equal(fmtUnitCost(1.2), "1.2¢");
  assert.equal(fmtUnitCost(380), "$3.80");
});

test("reservation needs from a job's items", () => {
  const tracked = new Map<number, TrackedMaterial>([
    [17, { id: 17, unit: "sheet" }], // 100# Gloss Text 12×18
    [1, { id: 1, unit: "sqft" }], // 13oz banner
    [11, { id: 11, unit: "each" }], // envelopes
    [40, { id: 40, unit: "roll" }],
  ]);
  const items = [
    // Print-estimated brochure: the estimate's parent sheets of the paper (materialId is the same paper — counted once).
    { id: 101, quantity: 500, widthIn: 11, heightIn: 8.5, materialId: 17, pricingBreakdown: { production: { paperId: 17, parentSheets: 264.4, pressSheets: 264 } } },
    // Banner 4×8 ft × 2 on tracked vinyl = 64 sq ft.
    { id: 102, quantity: 2, widthIn: 48, heightIn: 96, materialId: 1, pricingBreakdown: null },
    // Envelopes: quantity.
    { id: 103, quantity: 1000, widthIn: null, heightIn: null, materialId: 11, pricingBreakdown: {} },
    // Untracked paper in an estimate → nothing.
    { id: 104, quantity: 250, widthIn: 3.5, heightIn: 2, materialId: 20, pricingBreakdown: { production: { paperId: 20, parentSheets: 30 } } },
    // Sq ft material without a size → nothing; roll unit can't be worked out → nothing; no material → nothing.
    { id: 105, quantity: 1, widthIn: null, heightIn: null, materialId: 1, pricingBreakdown: null },
    { id: 106, quantity: 1, widthIn: 54, heightIn: 120, materialId: 40, pricingBreakdown: null },
    { id: 107, quantity: 5, widthIn: 24, heightIn: 18, materialId: null, pricingBreakdown: null },
  ];
  assert.deepEqual(reservationNeeds(items, tracked), [
    { materialId: 17, jobItemId: 101, quantity: 265 },
    { materialId: 1, jobItemId: 102, quantity: 64 },
    { materialId: 11, jobItemId: 103, quantity: 1000 },
  ]);
  assert.deepEqual(reservationNeeds(items, new Map()), [], "nothing tracked → nothing reserved");
});

test("planned reservations leave out what was already used; re-sync is a no-op when unchanged", () => {
  const needs = [
    { materialId: 17, jobItemId: 1, quantity: 265 },
    { materialId: 17, jobItemId: 2, quantity: 100 },
    { materialId: 1, jobItemId: 3, quantity: 64 },
  ];
  assert.deepEqual(planReservations(needs, new Map()), needs);
  // 300 sheets already taken by hand: item 1 fully covered, item 2 needs 65 more.
  assert.deepEqual(planReservations(needs, new Map([[17, 300]])), [
    { materialId: 17, jobItemId: 2, quantity: 65 },
    { materialId: 1, jobItemId: 3, quantity: 64 },
  ]);
  assert.deepEqual(planReservations(needs, new Map([[17, 1000], [1, 64]])), []);
  const existing = [
    { materialId: 1, jobItemId: 3, quantity: 64 },
    { materialId: 17, jobItemId: 1, quantity: 265 },
    { materialId: 17, jobItemId: 2, quantity: 100 },
  ];
  assert.equal(sameReservations(existing, needs), true);
  assert.equal(sameReservations(existing.slice(1), needs), false);
  assert.equal(sameReservations([{ materialId: 1, jobItemId: 3, quantity: 60 }], [{ materialId: 1, jobItemId: 3, quantity: 64 }]), false);
});

test("what a job's status means for its stock", () => {
  assert.equal(reservationActionFor("approved_for_production", false), "reserve");
  assert.equal(reservationActionFor("production", false), "reserve");
  assert.equal(reservationActionFor("on_hold", false), "reserve");
  assert.equal(reservationActionFor("finishing", false), "use");
  assert.equal(reservationActionFor("ready_pickup", false), "use");
  assert.equal(reservationActionFor("completed", false), "use");
  assert.equal(reservationActionFor("cancelled", false), "release");
  assert.equal(reservationActionFor("production", true), "release", "archived gives stock back");
});

test("receiving: partial and full status, what's left", () => {
  const l = (quantity: number, receivedQuantity: number) => ({ quantity, receivedQuantity });
  assert.equal(poStatusAfterReceive([l(5000, 0), l(10, 0)]), "ordered");
  assert.equal(poStatusAfterReceive([l(5000, 2500), l(10, 0)]), "partial");
  assert.equal(poStatusAfterReceive([l(5000, 5000), l(10, 0)]), "partial");
  assert.equal(poStatusAfterReceive([l(5000, 5000), l(10, 10)]), "received");
  assert.equal(poStatusAfterReceive([l(5000, 5200)]), "received", "overs count as received");
  assert.equal(remainingOf(l(5000, 2500)), 2500);
  assert.equal(remainingOf(l(5000, 5200)), 0);
  assert.deepEqual(poTotals([{ quantity: 5000, unitCostCents: 8 }, { quantity: 2500, unitCostCents: 20 }], 2500, 0), { subtotalCents: 90000, shippingCents: 2500, taxCents: 0, totalCents: 92500 });
  assert.equal(isPoOverdue({ status: "ordered", expectedOn: "2026-09-01" }, "2026-09-28"), true);
  assert.equal(isPoOverdue({ status: "partial", expectedOn: "2026-09-28" }, "2026-09-28"), false);
  assert.equal(isPoOverdue({ status: "received", expectedOn: "2026-09-01" }, "2026-09-28"), false);
  assert.equal(isPoOverdue({ status: "draft", expectedOn: "2026-09-01" }, "2026-09-28"), false);
});

test("suggested order quantities", () => {
  const m = (onHand: number, reserved: number, onOrder: number, reorderLevel: number | null, reorderQuantity: number | null, unit = "sheet") => ({ onHand, reserved, onOrder, reorderLevel, reorderQuantity, unit });
  assert.equal(suggestedOrderQty(m(5000, 0, 0, 1000, 5000)), 0, "plenty");
  assert.equal(suggestedOrderQty(m(900, 0, 0, 1000, 5000)), 5000, "low → the usual order");
  assert.equal(suggestedOrderQty(m(900, 0, 5000, 1000, 5000)), 0, "already on order");
  // Jobs need 6,000 with 800 on the shelf: cover them and get back to 1,000 → 6,200 → 6,500 (reams).
  assert.equal(suggestedOrderQty(m(800, 6000, 0, 1000, 5000)), 6500);
  // No reorder level, but jobs need more than we have → just the shortfall (rounded to reams).
  assert.equal(suggestedOrderQty(m(100, 400, 0, null, null)), 500);
  // No usual quantity → a reorder level's worth.
  assert.equal(suggestedOrderQty(m(150, 0, 0, 200, null, "sqft")), 200);
  assert.equal(suggestedOrderQty(m(150.5, 0, 0, 200, null, "sqft")), 200);
  assert.equal(packRound(1, "sheet"), 500);
  assert.equal(packRound(12.2, "sqft"), 13);
});

test("job costing: PO lines, stock used, no double counting", () => {
  // Outside die-cutting ($180) + special paper bought for the job (2,500 sh = $500), then 2,600 sheets used
  // (100 more than bought, from general stock at 8¢) + 64 sq ft of vinyl at 55¢. Shipping on the job's PO: $25.
  const r = jobPurchaseCosts(
    [
      { materialId: null, quantity: 1, amountCents: 18000 },
      { materialId: 17, quantity: 2500, amountCents: 50000 },
    ],
    [
      { materialId: 17, quantity: 2600, unitCostCents: 8 },
      { materialId: 1, quantity: 64, unitCostCents: 55 },
    ],
    2500,
  );
  assert.equal(r.purchasedMaterialCents, 50000);
  assert.equal(r.stockCents, 100 * 8 + 64 * 55);
  assert.equal(r.outsideCents, 18000 + 2500);
  assert.equal(r.materialCents, 50000 + 800 + 3520);
  assert.equal(r.totalCents, r.materialCents + r.outsideCents);
  assert.deepEqual(jobPurchaseCosts([], []), { stockCents: 0, purchasedMaterialCents: 0, outsideCents: 0, materialCents: 0, totalCents: 0 });
  // Sub-cent paper: 265 sheets at 1.2¢ = $3.18.
  assert.equal(jobPurchaseCosts([], [{ materialId: 12, quantity: 265, unitCostCents: 1.2 }]).stockCents, 318);
});

test("dashboard attention lines", () => {
  assert.deepEqual(inventoryAttention({ low: 0, out: 0, short: 0, overduePos: 0 }), []);
  const a = inventoryAttention({ low: 2, out: 0, short: 1, overduePos: 1 });
  assert.deepEqual(
    a.map((x) => x.text),
    ["1 stock item is short for upcoming jobs", "2 stock items are running low", "1 purchase order is late"],
  );
  assert.equal(a[0]!.tone, "red");
});

test("purchase order email for the vendor", () => {
  const { subject, text } = poEmail({
    company: { name: "Miss Print", phone: "219-836-2517", email: "orders@missprintusa.com" },
    vendor: { name: "Veritiv", contactName: "Sam Ortiz", accountNumber: "MP-4471" },
    po: { number: 1002, orderedOn: "2026-09-28", expectedOn: "2026-10-02", notes: "Back door, please.", subtotalCents: 40000, shippingCents: 2500, taxCents: 0, totalCents: 42500 },
    deliverTo: { name: "Munster", address: "8244 Calumet Ave, Munster, IN 46321" },
    lines: [{ description: "100# Gloss Text 12×18", sku: "GT100-1218", quantity: 5000, unit: "sheet", unitCostCents: 8, amountCents: 40000 }],
    message: "Please ship with Thursday's truck.",
  });
  assert.equal(subject, "Purchase order PO-1002 from Miss Print");
  assert.match(text, /^Hi Sam,/);
  assert.match(text, /Please ship with Thursday's truck\./);
  assert.match(text, /Our account #: MP-4471/);
  assert.match(text, /1\. 100# Gloss Text 12×18 \(item # GT100-1218\)\n {3}5,000 sheets @ 8¢\/sheet = \$400\.00/);
  assert.match(text, /Shipping: \$25\.00\nTotal: \$425\.00/);
  assert.match(text, /Deliver to:\nMiss Print — Munster\n8244 Calumet Ave/);
  assert.match(text, /Back door, please\./);
  assert.match(text, /Miss Print\n219-836-2517 · orders@missprintusa\.com$/);
});
