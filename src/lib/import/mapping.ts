/**
 * Reading a spreadsheet's header row and matching its columns to import fields. Pure (browser + tests).
 */
import { KINDS, type ImportKind } from "./fields";

/** Column index for each field key (null = "Don't import"). */
export type Mapping = Record<string, number | null>;

/**
 * "E-mail Address" → "email address", "Job #" / "Job No." / "Job Number" → "job no",
 * "Address1" → "address 1", "Zip/Postal Code" → "zip postal code".
 */
export function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/e[\s-]?mail/g, "email")
    .replace(/#/g, " no ")
    .replace(/&/g, " and ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(number|num|nbr|no)\b/g, "no")
    .replace(/\s+/g, " ")
    .trim();
}

const hasWords = (haystack: string, needle: string) => ` ${haystack} `.includes(` ${needle} `);

/**
 * Guess which column holds each field. Exact header matches win over partial ones, earlier synonyms
 * over later ones, and each column is used once.
 */
export function autoMap(headers: unknown[], kind: ImportKind): Mapping {
  const fields = KINDS[kind].fields;
  const norm = headers.map(normalizeHeader);
  const candidates: { field: string; col: number; score: number }[] = [];
  for (const f of fields) {
    const avoid = (f.avoid ?? []).map(normalizeHeader);
    f.synonyms.forEach((syn, i) => {
      const s = normalizeHeader(syn);
      norm.forEach((h, col) => {
        if (!h) return;
        if (avoid.some((a) => hasWords(h, a))) return;
        if (h === s) candidates.push({ field: f.key, col, score: 1000 - i });
        else if (s.length >= 4 && hasWords(h, s)) candidates.push({ field: f.key, col, score: 500 - i - (h.split(" ").length - s.split(" ").length) });
      });
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.col - b.col);
  const mapping: Mapping = Object.fromEntries(fields.map((f) => [f.key, null]));
  const usedCols = new Set<number>();
  for (const c of candidates) {
    if (mapping[c.field] != null || usedCols.has(c.col)) continue;
    mapping[c.field] = c.col;
    usedCols.add(c.col);
  }
  return mapping;
}

/** A cell from CSV or Excel as text. Excel dates become YYYY-MM-DD; whole numbers lose their ".0". */
export function cellToString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    // read-excel-file returns dates at UTC midnight; a time-of-day cell keeps its date part.
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    if (Number.isInteger(v)) return Math.abs(v) >= 1e21 ? v.toLocaleString("en-US", { useGrouping: false }) : String(v);
    return String(Number(v.toPrecision(12)));
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/**
 * Where the header row is: the first row (of the first 20) with at least two filled cells, so a
 * report title like "Customer List — printed 9/28/2026" above the headers is skipped.
 */
export function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const filled = (rows[i] ?? []).filter((c) => cellToString(c).trim() !== "").length;
    if (filled >= 2) return i;
  }
  return 0;
}

export type Sheet = { headers: string[]; rows: string[][]; headerRowIndex: number };

/**
 * Raw grid (CSV or Excel) → headers + data rows as text. Blank rows are dropped, but each kept row
 * remembers its spreadsheet row number (1-based, as the person sees it in Excel).
 */
export function toSheet(grid: unknown[][]): Sheet & { rowNumbers: number[] } {
  const h = findHeaderRow(grid);
  const headerCells = (grid[h] ?? []).map((c) => cellToString(c).trim());
  const width = Math.max(headerCells.length, ...grid.slice(h + 1).map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => headerCells[i] || `Column ${columnLetter(i)}`);
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  grid.slice(h + 1).forEach((r, i) => {
    const cells = Array.from({ length: width }, (_, c) => cellToString(r[c]));
    if (cells.every((c) => c.trim() === "")) return;
    rows.push(cells);
    rowNumbers.push(h + i + 2);
  });
  return { headers, rows, headerRowIndex: h, rowNumbers };
}

/** 0 → A, 25 → Z, 26 → AA */
export function columnLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** The mapped cells of one row, keyed by field ({ name: "ABC Plumbing", phone: "219…" }). */
export function pickFields(row: string[], mapping: Mapping): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, col] of Object.entries(mapping)) {
    if (col == null) continue;
    const v = row[col];
    if (v != null && v.trim() !== "") out[key] = v;
  }
  return out;
}
