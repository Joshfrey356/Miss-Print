// Money labels & small pure helpers. Safe for both server and client components.
import type { ExpenseCategory, PaymentMethod } from "@/lib/db/schema";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = { cash: "Cash", check: "Check", card: "Card", ach: "ACH / Bank transfer", other: "Other" };
export const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  materials: "Materials",
  ink_toner: "Ink / Toner",
  paper: "Paper",
  vinyl: "Vinyl",
  substrates: "Substrates",
  outside_services: "Outside Services",
  shipping: "Shipping",
  equipment: "Equipment",
  vehicle: "Vehicle",
  installation: "Installation",
  office: "Office",
  marketing: "Marketing",
  payroll: "Payroll-related",
  other: "Other",
};
export const EXPENSE_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[];

/** How an expense was paid. Stored as this text on expenses.payment_method (matches existing data). */
export const EXPENSE_PAYMENT_METHODS = ["Card", "Check", "Cash", "ACH", "Account"] as const;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];
/** Normalize stored/typed values ("card", "ACH") to the canonical option, or null. */
export const normalizeExpensePayment = (v: string | null | undefined): ExpensePaymentMethod | null =>
  EXPENSE_PAYMENT_METHODS.find((m) => m.toLowerCase() === v?.trim().toLowerCase()) ?? null;
export const expensePaymentLabel = (v: string | null | undefined) => (v ? (normalizeExpensePayment(v) === "Account" ? "On account" : (normalizeExpensePayment(v) ?? v)) : "—");

/** Margin below this is flagged as "low" on profitability views. */
export const LOW_MARGIN = 0.3;

/** "2026-09" → "Sep 2026" */
export function monthLabel(ym: string, short = false) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 15)).toLocaleDateString("en-US", { timeZone: "UTC", month: short ? "short" : "long", year: short ? undefined : "numeric" });
}

/** YYYY-MM of `ym` shifted by n months. */
export function addMonths(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Last day of month for YYYY-MM as YYYY-MM-DD */
export function monthEnd(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}
