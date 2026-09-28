/**
 * Value parsers for spreadsheet imports (Settings → Import). Pure and safe on the client, so the
 * preview in the browser and the import on the server read every cell the same way.
 *
 * Convention: each parser returns the value, `null` when the cell is blank, and `undefined` when
 * the cell has something in it that can't be read (the caller turns that into a row problem).
 */

/** A spreadsheet cell as text: trims, collapses inner whitespace, and treats "-", "n/a", "null" as blank. */
export function clean(input: unknown): string {
  if (input == null) return "";
  const s = String(input)
    .replace(/[ \s]+/g, " ")
    .trim();
  return /^(-+|n\/?a|null|none|#n\/a)$/i.test(s) ? "" : s;
}

/** Like clean() but keeps line breaks (notes, addresses). */
export function cleanMultiline(input: unknown): string {
  if (input == null) return "";
  return String(input)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * "$1,234.50" → 1234.5 dollars. Handles "(12.00)" and "12.00-" as negatives, "USD", spaces.
 * Keeps fractions of a cent (paper can cost $0.085 a sheet).
 */
export function parseDollars(input: unknown): number | null | undefined {
  if (typeof input === "number") return Number.isFinite(input) ? input : undefined;
  let s = clean(input);
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/-$/.test(s)) {
    neg = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/usd|us\$|\$|,|\s/gi, "");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return neg ? -n : n;
}

/** "$1,234.50" → 123450 cents. */
export function parseCents(input: unknown): number | null | undefined {
  const d = parseDollars(input);
  if (d == null) return d;
  return Math.round(d * 100);
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** "1,000" → 1000, "500 pcs" → 500, "2.5M" / "5k" → 2500 / 5000. Rounds to a whole number. */
export function parseQuantity(input: unknown): number | null | undefined {
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input) : undefined;
  const s = clean(input).toLowerCase();
  if (!s) return null;
  const m = s
    .replace(/,/g, "")
    .match(/^(\d+(?:\.\d+)?|\.\d+)\s*(m|k|thousand)?\b\s*(pcs?|pieces?|ea|each|qty|units?|sets?|sheets?|cards?|boxes?|bx|ct|count)?\.?$/);
  if (!m) return undefined;
  let n = Number(m[1]);
  if (m[2]) n *= 1000;
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

/** Plain decimal ("12.5", "1,200") or undefined when it isn't a number. */
export function parseNumber(input: unknown): number | null | undefined {
  if (typeof input === "number") return Number.isFinite(input) ? input : undefined;
  const s = clean(input).replace(/,/g, "");
  if (!s) return null;
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return undefined;
  return Number(s);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function ymd(y: number, m: number, d: number): string | undefined {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return undefined;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > days) return undefined;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Two-digit years: 00–(this year + 10) → 2000s, the rest → 1900s. */
function fullYear(y: number, now = new Date()): number {
  if (y >= 100) return y;
  const pivot = (now.getUTCFullYear() % 100) + 10;
  return y <= pivot ? 2000 + y : 1900 + y;
}

/** Excel stores dates as days since 1899-12-30 (with the 1900 leap-year bug baked in). */
export function excelSerialToYmd(serial: number): string | undefined {
  if (!Number.isFinite(serial) || serial < 1 || serial > 80000) return undefined;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * US-style dates → "YYYY-MM-DD": 3/7/2024, 03-07-24, 2024-03-07, 2024/3/7, Mar 7, 2024,
 * 7-Mar-2024, March 7 2024, and Excel serial numbers (45358). A time after the date is ignored.
 */
export function parseDate(input: unknown): string | null | undefined {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? undefined : input.toISOString().slice(0, 10);
  if (typeof input === "number") return excelSerialToYmd(input);
  let s = clean(input);
  if (!s) return null;
  // Drop a trailing time: "3/7/2024 10:15 AM", "2024-03-07T00:00:00Z", "2024-03-07 00:00:00"
  s = s.replace(/[T\s]+\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(am|pm)?\s*(z|[+-]\d{2}:?\d{2})?$/i, "").trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return ymd(+m[1]!, +m[2]!, +m[3]!);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) return ymd(fullYear(+m[3]!), +m[1]!, +m[2]!);
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/)) && +m[1]! >= 1900) return ymd(+m[1]!, +m[2]!, +m[3]!);
  if ((m = s.match(/^\d{4,5}(\.\d+)?$/))) return excelSerialToYmd(Number(s));
  // "Mar 7, 2024", "March 7 2024", "Mar. 7th, 24"
  if ((m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2}|\d{4})$/i))) {
    const mo = MONTHS[m[1]!.toLowerCase().slice(0, m[1]!.toLowerCase().startsWith("sept") ? 4 : 3)];
    return mo ? ymd(fullYear(+m[3]!), mo, +m[2]!) : undefined;
  }
  // "7-Mar-2024", "7 Mar 24", "07-MAR-24"
  if ((m = s.match(/^(\d{1,2})[-\s]([a-z]{3,9})\.?[-\s,]+(\d{2}|\d{4})$/i))) {
    const mo = MONTHS[m[2]!.toLowerCase().slice(0, 3)];
    return mo ? ymd(fullYear(+m[3]!), mo, +m[1]!) : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

const FRACTION = String.raw`\d+(?:\.\d+)?(?:[\s-]+\d+\/\d+)?|\d+\/\d+|\.\d+`;

function num(text: string): number {
  const t = text.trim();
  const mixed = t.match(/^(\d+(?:\.\d+)?)[\s-]+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(t);
}

type Unit = "in" | "ft" | "mm" | "cm" | null;

/** One side of a size: 24, 24", 24in, 2', 2ft, 2'6", 8 1/2, 8-1/2, 600mm. */
function parseLength(text: string): { value: number; unit: Unit } | undefined {
  const t = text.trim().toLowerCase().replace(/[″”“]/g, '"').replace(/[′’‘]/g, "'").replace(/''/g, '"');
  const feetInches = t.match(new RegExp(`^(${FRACTION})\\s*(?:'|ft\\.?|feet|foot)\\s*(${FRACTION})\\s*(?:"|in\\.?|inch|inches)?$`));
  if (feetInches) return { value: num(feetInches[1]!) * 12 + num(feetInches[2]!), unit: "in" };
  const m = t.match(new RegExp(`^(${FRACTION})\\s*("|in\\.?|inch|inches|'|ft\\.?|feet|foot|mm|cm)?$`));
  if (!m) return undefined;
  const value = num(m[1]!);
  if (!Number.isFinite(value)) return undefined;
  const u = m[2]?.replace(".", "") ?? "";
  const unit: Unit =
    u === '"' || u.startsWith("in") ? "in" : u === "'" || u === "ft" || u === "feet" || u === "foot" ? "ft" : u === "mm" ? "mm" : u === "cm" ? "cm" : null;
  return { value, unit };
}

const toInches = (v: number, unit: Unit) => (unit === "ft" ? v * 12 : unit === "mm" ? v / 25.4 : unit === "cm" ? v / 2.54 : v);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * "4x8", "8.5 x 11", '24"x36"', "2'x4'", "3 ft x 6 ft", "8 1/2 x 11", "2'6\" x 4'" → inches.
 * A unit written on one side applies to both. With no unit at all, sizes are inches — unless
 * `feetWhenSmall` is set (sign work) and both numbers are 16 or less: then "4x8" means 4 ft × 8 ft.
 * Anything after the size ("24x36 poster", "12x18 (full bleed)") is ignored; a third number (depth) too.
 */
export function parseSize(
  input: unknown,
  opts: { feetWhenSmall?: boolean } = {},
): { widthIn: number; heightIn: number; assumedFeet?: boolean } | null | undefined {
  const s = clean(input);
  if (!s) return null;
  const norm = s.replace(/[″”“]/g, '"').replace(/[′’‘]/g, "'");
  const side = String.raw`(?:${FRACTION})\s*(?:'\s*(?:${FRACTION})\s*(?:"|in\.?)?|"|''|in(?:ch(?:es)?)?\.?|'|ft\.?|feet|foot|mm|cm)?`;
  const m = norm.match(new RegExp(String.raw`^\s*(${side})\s*(?:x|×|\*|by)\s*(${side})(?=$|[\s,;(x×*]|[a-z])`, "i"));
  if (!m) return undefined;
  const a = parseLength(m[1]!);
  const b = parseLength(m[2]!);
  if (!a || !b || a.value <= 0 || b.value <= 0) return undefined;
  const unit = a.unit ?? b.unit;
  if (!unit && opts.feetWhenSmall && a.value <= 16 && b.value <= 16) {
    return { widthIn: round3(a.value * 12), heightIn: round3(b.value * 12), assumedFeet: true };
  }
  return { widthIn: round3(toInches(a.value, a.unit ?? unit)), heightIn: round3(toInches(b.value, b.unit ?? unit)) };
}

/** A single measurement column ("Width": 24, '24"', "2 ft") → inches. */
export function parseInches(input: unknown): number | null | undefined {
  if (typeof input === "number") return input > 0 ? input : undefined;
  const s = clean(input);
  if (!s) return null;
  const l = parseLength(s);
  if (!l || l.value <= 0) return undefined;
  return round3(toInches(l.value, l.unit));
}

// ---------------------------------------------------------------------------
// Yes / no, terms, contact details
// ---------------------------------------------------------------------------

/** "Yes", "Y", "TRUE", "1", "x", "Exempt" → true; "No", "N", "FALSE", "0", "Taxable" → false. */
export function parseBool(input: unknown): boolean | null | undefined {
  if (typeof input === "boolean") return input;
  if (typeof input === "number") return input !== 0;
  const s = clean(input).toLowerCase();
  if (!s) return null;
  if (/^(y|yes|true|t|1|x|✓|✔|on|exempt|tax exempt|non-?taxable|primary)$/.test(s)) return true;
  if (/^(n|no|false|f|0|off|taxable|not exempt)$/.test(s)) return false;
  return undefined;
}

export type PaymentTerms = "due_on_receipt" | "net_15" | "net_30" | "net_45" | "net_60";

/**
 * "Net 30", "N30", "30 days", "NET30" → net_30; "COD", "Due on receipt", "Cash", "Prepaid" → due_on_receipt.
 * Other day counts go to the closest option, and `exact` says whether it was a clean match.
 */
export function parseTerms(input: unknown): { terms: PaymentTerms; exact: boolean } | null | undefined {
  const s = clean(input).toLowerCase();
  if (!s) return null;
  if (/(receipt|c\.?o\.?d|cash|prepa|pre-pa|immediate|upon|credit card|card on file|due now|in advance|^due$|^none$|^0 ?days?$|^net ?0$)/.test(s)) {
    return { terms: "due_on_receipt", exact: true };
  }
  const m = s.match(/(\d{1,3})/);
  if (!m) return undefined;
  const days = Number(m[1]);
  const options: [number, PaymentTerms][] = [
    [0, "due_on_receipt"],
    [15, "net_15"],
    [30, "net_30"],
    [45, "net_45"],
    [60, "net_60"],
  ];
  let best = options[0]!;
  for (const o of options) if (Math.abs(o[0] - days) < Math.abs(best[0] - days)) best = o;
  return { terms: best[1], exact: best[0] === days };
}

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i;

/** First email in the cell, lower-cased. "Bob <bob@x.com>; amy@x.com" → bob@x.com (and `more` = true). */
export function parseEmail(input: unknown): { email: string; more: boolean } | null | undefined {
  const s = clean(input);
  if (!s) return null;
  const parts = s
    .split(/[;,\s]+/)
    .map((p) => p.replace(/^mailto:/i, "").replace(/^[<(["']+|[>)\]"'.]+$/g, ""))
    .filter((p) => p.includes("@"));
  if (!parts.length || !EMAIL_RE.test(parts[0]!)) return undefined;
  return { email: parts[0]!.toLowerCase(), more: parts.length > 1 };
}

/**
 * Phone numbers are kept as typed, except bare digit runs (Excel often stores 2195550142 as a number):
 * those become 219-555-0142. Needs at least 7 digits.
 */
export function parsePhone(input: unknown): string | null | undefined {
  const s = typeof input === "number" ? String(Math.round(input)) : clean(input);
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7) return undefined;
  if (/^\+?1?[\s.-]?\d{10}$/.test(s.replace(/\s/g, "")) || /^\d{10,11}$/.test(s)) {
    const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (/^\d{7}$/.test(s)) return `${s.slice(0, 3)}-${s.slice(3)}`;
  return s.slice(0, 40);
}

const STATES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "puerto rico": "PR",
  ind: "IN",
  ill: "IL",
  mich: "MI",
  wis: "WI",
};

/** "in", "Indiana", "Ind." → "IN". Anything else is kept as typed. */
export function parseState(input: unknown): string | null {
  const s = clean(input).replace(/\.$/, "");
  if (!s) return null;
  if (/^[a-z]{2}$/i.test(s)) return s.toUpperCase();
  return STATES[s.toLowerCase()] ?? s.slice(0, 40);
}

/** ZIPs that lost their leading zero in Excel (6511 → 06511), and 463211234 → 46321-1234. */
export function parseZip(input: unknown): string | null {
  const s = typeof input === "number" ? String(Math.round(input)) : clean(input);
  if (!s) return null;
  if (/^\d{3,4}$/.test(s)) return s.padStart(5, "0");
  if (/^\d{9}$/.test(s)) return `${s.slice(0, 5)}-${s.slice(5)}`;
  if (/^\d{7,8}$/.test(s)) return `${s.padStart(9, "0").slice(0, 5)}-${s.padStart(9, "0").slice(5)}`;
  return s.slice(0, 20);
}

/** "www.x.com" stays as typed; obvious non-sites ("n/a", "none") are blank. */
export function parseWebsite(input: unknown): string | null {
  const s = clean(input);
  if (!s || !/[a-z0-9-]\.[a-z]{2,}/i.test(s)) return null;
  return s.slice(0, 200);
}

/** "Mary", "Jones" → "Mary Jones". */
export function combineName(...parts: unknown[]): string {
  return parts.map(clean).filter(Boolean).join(" ");
}

/** Legal endings ignored when matching names: "ABC Plumbing, Inc." = "ABC Plumbing". */
export const NAME_SUFFIX_RE = "( (inc|llc|ltd|co|corp|corporation|company|incorporated|pc|pllc|lp|llp))+$";

/**
 * Key used to match names: case, punctuation, "&" vs "and" and endings like Inc./LLC/Co. don't
 * matter ("ABC Plumbing, Inc." = "abc plumbing"). Must stay identical to the SQL in
 * src/lib/import/server.ts (keySql).
 */
export function nameKey(input: unknown): string {
  return String(input ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(new RegExp(NAME_SUFFIX_RE), "");
}
