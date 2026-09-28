/**
 * Parsing & formatting for the estimating catalog (paper, presses, bindery & services).
 * Pure — safe on the client (live previews in the forms) and on the server (Server Actions).
 *
 * Money is integer cents everywhere, except RATES below a cent (click charges, per-piece bindery),
 * which are cents with up to 4 decimals (4.5 = 4.5¢ = $0.045), matching the numeric columns.
 */

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** "12", "12.5", '12.5"', "12 1/2", "12-1/2", "1/8", "0.125 in" → inches. Null when blank/invalid. */
export function parseInches(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input)
    .trim()
    .toLowerCase()
    .replace(/(inches|inch|in\.?|″|"|'')$/g, "")
    .trim();
  if (s === "") return null;
  let m = s.match(/^(?:(\d+(?:\.\d+)?)(?:\s+|-))?(\d+)\/(\d+)$/);
  if (m) {
    const whole = m[1] ? Number(m[1]) : 0;
    const den = Number(m[3]);
    if (!den) return null;
    return round4(whole + Number(m[2]) / den);
  }
  m = s.match(/^(\d*\.?\d+)$/);
  return m ? round4(Number(m[1])) : null;
}

/** "12 x 18", "12×18", '12" x 18"', "12 by 18", "8 1/2 x 11" → { widthIn, heightIn }. */
export function parseSize(input: string | null | undefined): { widthIn: number; heightIn: number } | null {
  if (input == null) return null;
  const parts = String(input)
    .trim()
    .split(/\s*(?:[x×X*]|\bby\b)\s*/);
  if (parts.length !== 2) return null;
  const w = parseInches(parts[0]);
  const h = parseInches(parts[1]);
  return w && h && w > 0 && h > 0 ? { widthIn: w, heightIn: h } : null;
}

/** 12.5 → "12.5", 12 → "12", 0.125 → "0.125" */
export const fmtInches = (n: number) => String(Math.round(n * 1000) / 1000);
/** "12 × 18" */
export const fmtSheet = (w: number | null | undefined, h: number | null | undefined) => (w && h ? `${fmtInches(w)} × ${fmtInches(h)}` : "");

/** "25%", "25", " 2.5 % " → 0.25 / 0.025. Null when blank; NaN when not a number. */
export function parsePct(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).replace(/[%,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 10000 : NaN;
}

/** 0.3 → "30", 0.025 → "2.5", null → "" (for inputs). */
export const pctToInput = (v: number | null | undefined) => (v == null ? "" : String(Math.round(v * 10000) / 100));

/**
 * A price that may be below a cent: "4.5¢", "4.5c", "4.5 cents", "$0.045", "0.045", ".30", "$1.25".
 * Plain numbers are dollars, like every other money box. Returns cents with up to 4 decimals,
 * null when blank, NaN when it isn't a price.
 */
export function parseRateCents(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase().replace(/,/g, "");
  if (s === "") return null;
  const cents = s.match(/^(\d*\.?\d+)\s*(?:¢|c|cents?|cent)$/);
  if (cents) return round4(Number(cents[1]));
  const dollars = s.match(/^\$?\s*(\d*\.?\d+)$/);
  if (dollars) return round4(Number(dollars[1]) * 100);
  return NaN;
}

/** Whole cents from "$185", "185.00", "1,250" (dollars). Null when blank, NaN when invalid. */
export function parseMoneyCents(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

/** Whole number from "6,000", "10". Null when blank, NaN when not a whole number. */
export function parseCount(input: string | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).replace(/[,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isInteger(n) ? n : NaN;
}

/** A rate for display: fractions of a cent → "4.5¢", otherwise dollars "$0.30", "$1.25". */
export function fmtRate(cents: number | null | undefined): string {
  if (cents == null) return "—";
  if (cents > 0 && cents < 100 && !Number.isInteger(cents)) return `${Math.round(cents * 100) / 100}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

/** A rate for an input box, in dollars: 4.5 → "0.045", 30 → "0.30", 1250 → "12.50". */
export function rateToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  const d = cents / 100;
  const fixed2 = d.toFixed(2);
  return Math.abs(Number(fixed2) - d) < 1e-9 ? fixed2 : String(Math.round(d * 1_000_000) / 1_000_000);
}

/** "$12.50", "$0.08" — whole cents. */
export const fmtMoney = (cents: number | null | undefined) =>
  cents == null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
