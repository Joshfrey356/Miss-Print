import { test } from "node:test";
import assert from "node:assert/strict";
import { cartTotals, cashPayment, changeDue, dayTotals, lineTotal, overShort, overShortLabel, quickCash } from "../src/lib/counter/math";
import { receiptEmail } from "../src/lib/counter/receipt";

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

test("counter sale totals: tax only on taxable lines, rounded to the cent", () => {
  const lines = [
    { amountCents: 4500, taxable: true }, // business cards
    { amountCents: 1999, taxable: true },
    { amountCents: 7500, taxable: false }, // design time, not taxed
  ];
  const t = cartTotals(lines, 0.07, false);
  assert.equal(t.subtotalCents, 13999);
  assert.equal(t.taxableCents, 6499);
  assert.equal(t.taxCents, 455); // 454.93 → 455
  assert.equal(t.totalCents, 14454);
  assert.equal(t.taxRate, 0.07);
});

test("tax-exempt customers pay no tax", () => {
  const t = cartTotals([{ amountCents: 10000, taxable: true }], 0.07, true);
  assert.equal(t.taxCents, 0);
  assert.equal(t.totalCents, 10000);
  assert.equal(t.taxRate, 0);
});

test("line total for N at $X each", () => {
  assert.equal(lineTotal(250, 12), 3000);
  assert.equal(lineTotal(3, 333), 999);
  assert.equal(lineTotal(-1, 100), 0);
});

test("cash: change due when they hand over more; partial when less", () => {
  assert.deepEqual(cashPayment(1454, 2000), { appliedCents: 1454, changeCents: 546 });
  assert.deepEqual(cashPayment(1454, 1454), { appliedCents: 1454, changeCents: 0 });
  assert.deepEqual(cashPayment(5000, 2000), { appliedCents: 2000, changeCents: 0 }); // split: $20 cash, rest by card
  assert.deepEqual(cashPayment(1000, -5), { appliedCents: 0, changeCents: 0 });
  assert.equal(changeDue({ amountCents: 1454, tenderedCents: 2000 }), 546);
  assert.equal(changeDue({ amountCents: 1454, tenderedCents: null }), 0);
});

test("quick cash buttons: exact, then the next round bills", () => {
  assert.deepEqual(quickCash(1454), [1454, 1500, 2000, 5000, 10000]);
  assert.deepEqual(quickCash(2000), [2000, 5000, 10000]);
  assert.deepEqual(quickCash(0), []);
});

test("end of day: totals by method, voided left out, expected cash = cash payments", () => {
  const d = dayTotals([
    { method: "cash", amountCents: 1454 },
    { method: "cash", amountCents: 3000 },
    { method: "card", amountCents: 12000 },
    { method: "check", amountCents: 25000 },
    { method: "cash", amountCents: 9999, voided: true },
  ]);
  assert.deepEqual(d.totals, { cash: 4454, card: 12000, check: 25000 });
  assert.deepEqual(d.counts, { cash: 2, card: 1, check: 1 });
  assert.equal(d.allCents, 41454);
  assert.equal(d.expectedCashCents, 4454);
  assert.equal(overShort(4400, 4454), -54);
  assert.equal(overShortLabel(-54, fmt), "Short $0.54");
  assert.equal(overShortLabel(100, fmt), "Over $1.00");
  assert.equal(overShortLabel(0, fmt), "Even");
  assert.equal(dayTotals([]).expectedCashCents, 0);
});

test("receipt email lists lines, payments with change and PAID IN FULL", () => {
  const { subject, text } = receiptEmail({
    company: { name: "Miss Print", tagline: "", phone: "219-836-2517", email: "orders@missprintusa.com", website: "", address: "8244 Calumet Ave" },
    sale: {
      inv: { number: 7001, issueDate: "2026-09-28", subtotalCents: 1359, taxCents: 95, taxRate: 0.07, totalCents: 1454, paidCents: 1454, status: "paid" },
      customer: { name: "Walk-in" },
      job: null,
      items: [{ description: "Color copies", quantity: 50, amountCents: 1359 }],
      payments: [{ p: { method: "cash", amountCents: 1454, tenderedCents: 2000, reference: null, voidedAt: null, receivedOn: "2026-09-28" } }],
    },
    jobPrefix: "MP",
  });
  assert.equal(subject, "Your receipt from Miss Print — INV-7001");
  assert.match(text, /Hi there,/);
  assert.match(text, /50 × Color copies\s+\$13\.59/);
  assert.match(text, /Sales tax \(7%\)\s+\$0\.95/);
  assert.match(text, /change \$5\.46/);
  assert.match(text, /PAID IN FULL/);
  assert.doesNotMatch(text, /Your order is/);
});

test("receipt email names the job with the shop's prefix", () => {
  const { text } = receiptEmail({
    company: { name: "Lakeshore Signs", tagline: "", phone: "", email: "", website: "", address: "" },
    sale: {
      inv: { number: 7002, issueDate: "2026-09-28", subtotalCents: 1000, taxCents: 0, taxRate: 0, totalCents: 1000, paidCents: 0, status: "open" },
      customer: { name: "Dana" },
      job: { number: 1002 },
      items: [{ description: "Yard signs", quantity: 10, amountCents: 1000 }],
      payments: [],
    },
    jobPrefix: "LS",
  });
  assert.match(text, /Your order is LS-1002\./);
  assert.doesNotMatch(text, /MP-/);
});

import { counterPrintInput, counterPrintOptions, printDescription, shortProduction } from "../src/lib/counter/print";

test("print items at the counter: category defaults with the counter's sides and paper", () => {
  const pc = { paperIds: [20, 19], defaultPaperId: 20, defaultPages: 2, defaultColorsFront: 4, defaultColorsBack: 4, defaultBleed: true, defaultOperationIds: [2] };
  const papers = [
    { id: 18, name: "80# Text" },
    { id: 19, name: "100# Cover" },
    { id: 20, name: "14pt C2S" },
  ];
  assert.deepEqual(counterPrintOptions(pc, papers), { papers: [{ id: 19, name: "100# Cover" }, { id: 20, name: "14pt C2S" }], defaultPaperId: 20, defaultPages: 2 });
  // No allowed list = every paper; default falls back to the first.
  assert.equal(counterPrintOptions({}, papers).defaultPaperId, 18);
  assert.equal(counterPrintOptions({}, papers).defaultPages, 1);
  assert.deepEqual(counterPrintInput(pc, { pages: 2, paperId: 19 }), { pages: 2, colorsFront: 4, colorsBack: 4, bleed: true, paperId: 19, pressId: null, operationIds: [2], servicesChosen: true });
  // Switching to one side drops the back colors; a one-sided category switched to two-sided prints the back too.
  assert.equal(counterPrintInput(pc, { pages: 1, paperId: 20 }).colorsBack, 0);
  assert.equal(counterPrintInput({ defaultColorsFront: 4, defaultColorsBack: 0 }, { pages: 2, paperId: null }).colorsBack, 4);
  assert.equal(printDescription("Business Cards", 3.5, 2, 2, "14pt C2S"), "Business Cards — 3.5 × 2, two-sided, 14pt C2S");
  assert.equal(shortProduction({ ups: 21, pressSheets: 59, pressName: "Konica C4080" }), "21 up · 59 sheets · Konica C4080");
});
