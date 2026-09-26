// CSV building for bookkeeper exports. RFC 4180 quoting + spreadsheet formula-injection guard.

export type CsvValue = string | number | boolean | null | undefined;

export function csvCell(v: CsvValue): string {
  if (v == null) return "";
  let s = String(v);
  // Cells starting with = + - @ (or tab/CR) can run as formulas in Excel/Sheets. Numbers are safe.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: CsvValue[][]): string {
  // BOM so Excel opens UTF-8 (names with accents, "·") correctly.
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Cents → "1234.50" (no $ or commas, for imports). */
export const csvMoney = (cents: number | null | undefined) => ((cents ?? 0) / 100).toFixed(2);
