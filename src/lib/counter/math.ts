/**
 * Front-counter arithmetic. Pure and client-safe (the sale screen shows live totals);
 * the server recomputes everything with the same functions when the sale is saved.
 * Money is integer cents.
 */
import { taxFor } from "@/lib/pricing/engine";

export type CounterLine = {
  description: string;
  quantity: number;
  /** Line total in cents (what the customer pays for this line). */
  amountCents: number;
  taxable: boolean;
};

/** Line total for "N at $X each", rounded to the cent. */
export const lineTotal = (quantity: number, unitCents: number) => Math.round(Math.max(0, quantity) * Math.max(0, unitCents));

export function cartTotals(lines: Pick<CounterLine, "amountCents" | "taxable">[], taxRate: number, taxExempt: boolean) {
  const subtotalCents = lines.reduce((a, l) => a + l.amountCents, 0);
  const taxableCents = lines.filter((l) => l.taxable).reduce((a, l) => a + l.amountCents, 0);
  const taxCents = taxFor(taxableCents, taxRate, taxExempt);
  return { subtotalCents, taxableCents, taxCents, totalCents: subtotalCents + taxCents, taxRate: taxExempt ? 0 : taxRate };
}

/**
 * Cash at the counter. `amountCents` is what the customer wants to put on the sale with cash
 * (usually the whole balance); `tenderedCents` is what they hand over.
 * - handed over at least the amount → the amount is paid and the rest is change;
 * - handed over less → only what they handed over is paid (the rest stays owed / goes on another method).
 */
export function cashPayment(amountCents: number, tenderedCents: number): { appliedCents: number; changeCents: number } {
  const amount = Math.max(0, Math.round(amountCents));
  const tendered = Math.max(0, Math.round(tenderedCents));
  if (tendered >= amount) return { appliedCents: amount, changeCents: tendered - amount };
  return { appliedCents: tendered, changeCents: 0 };
}

/** Change for a recorded cash payment (tendered is stored only when more was handed over). */
export const changeDue = (p: { amountCents: number; tenderedCents: number | null }) => Math.max(0, (p.tenderedCents ?? p.amountCents) - p.amountCents);

/** Quick "cash handed over" buttons for an amount: exact, then the next round bills. */
export function quickCash(amountCents: number): number[] {
  if (amountCents <= 0) return [];
  const out = new Set<number>([amountCents]);
  for (const step of [100, 500, 1000, 2000, 5000, 10000]) {
    const up = Math.ceil(amountCents / step) * step;
    if (up > amountCents) out.add(up);
  }
  return [...out].sort((a, b) => a - b).slice(0, 5);
}

/** Totals by payment method for a day, and the cash that should be in the drawer. */
export function dayTotals(payments: { method: string; amountCents: number; voided?: boolean }[]) {
  const totals: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const p of payments) {
    if (p.voided) continue;
    totals[p.method] = (totals[p.method] ?? 0) + p.amountCents;
    counts[p.method] = (counts[p.method] ?? 0) + 1;
  }
  const allCents = Object.values(totals).reduce((a, b) => a + b, 0);
  return { totals, counts, allCents, expectedCashCents: totals.cash ?? 0 };
}

/** Counted − expected: positive = over, negative = short. */
export const overShort = (countedCents: number, expectedCents: number) => countedCents - expectedCents;

/** "Over $2.00" / "Short $1.50" / "Even" */
export function overShortLabel(diffCents: number, fmt: (c: number) => string) {
  if (diffCents === 0) return "Even";
  return diffCents > 0 ? `Over ${fmt(diffCents)}` : `Short ${fmt(-diffCents)}`;
}
