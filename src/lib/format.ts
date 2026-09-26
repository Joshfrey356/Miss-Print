// Formatting helpers. Safe for both server and client.

export const money = (cents: number | null | undefined, opts: { cents?: boolean } = {}) => {
  const v = (cents ?? 0) / 100;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents === false ? 0 : 2,
    maximumFractionDigits: opts.cents === false ? 0 : 2,
  });
};

/** Compact money for dashboard cards: $12,480 / $1.2M */
export const moneyShort = (cents: number | null | undefined) => {
  const v = (cents ?? 0) / 100;
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
};

/** "185.00" / "$185" / "185" → 18500 cents. Returns null when blank/invalid. */
export function parseMoney(input: FormDataEntryValue | string | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export const centsToInput = (cents: number | null | undefined) =>
  cents == null ? "" : (cents / 100).toFixed(2);

export const pct = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`;

export const jobNo = (n: number) => `MP-${n}`;
export const quoteNo = (n: number) => `Q-${n}`;
export const invoiceNo = (n: number) => `INV-${n}`;

/** Parse "MP-10428", "mp10428", "10428" → 10428 */
export function parseJobNumber(s: string): number | null {
  const m = s.trim().match(/^(?:mp[-\s]?)?(\d{4,7})$/i);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Dates. Business dates (due dates) are stored as `date` = "YYYY-MM-DD" strings
// and interpreted in the shop's local time zone.
// ---------------------------------------------------------------------------
export const SHOP_TZ = "America/Chicago"; // Munster/Hammond are on Central Time

/** Today's date in the shop time zone as YYYY-MM-DD. */
export function today(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: SHOP_TZ });
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.UTC(...(fromYmd.split("-").map(Number) as [number, number, number]));
  const b = Date.UTC(...(toYmd.split("-").map(Number) as [number, number, number]));
  return Math.round((b - a) / 86400000);
}

const ymdToDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

/** "Mon, Sep 28" */
export function fmtDate(ymd: string | null | undefined, opts: { year?: boolean; weekday?: boolean } = {}) {
  if (!ymd) return "—";
  return ymdToDate(ymd).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: opts.weekday === false ? undefined : "short",
    month: "short",
    day: "numeric",
    year: opts.year ? "numeric" : undefined,
  });
}

/** Relative due label: "Today", "Tomorrow", "Yesterday", "3 days late", "Fri, Oct 2" */
export function dueLabel(ymd: string | null | undefined, now = today()) {
  if (!ymd) return "No due date";
  const diff = daysBetween(now, ymd);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "1 day late";
  if (diff < 0) return `${-diff} days late`;
  if (diff < 7) return ymdToDate(ymd).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" });
  return fmtDate(ymd);
}

export function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    timeZone: SHOP_TZ,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtTime(d: Date | string | null | undefined) {
  if (!d) return "";
  return new Date(d).toLocaleTimeString("en-US", { timeZone: SHOP_TZ, hour: "numeric", minute: "2-digit" });
}

/** "just now", "5 min ago", "3 hr ago", "Yesterday", "Sep 12" */
export function timeAgo(d: Date | string | null | undefined) {
  if (!d) return "";
  const t = new Date(d).getTime();
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 172800) return "Yesterday";
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return new Date(d).toLocaleDateString("en-US", { timeZone: SHOP_TZ, month: "short", day: "numeric" });
}

/** Local date (shop TZ) of a timestamp as YYYY-MM-DD */
export function ymdOf(d: Date | string) {
  return new Date(d).toLocaleDateString("en-CA", { timeZone: SHOP_TZ });
}

/** Dimensions in inches → "4' × 8'" when both are whole feet, else 24" × 36" */
export function fmtSize(w: number | null | undefined, h: number | null | undefined) {
  if (!w || !h) return "";
  const feet = w % 12 === 0 && h % 12 === 0 && w >= 12 && h >= 12;
  if (feet) return `${w / 12}' × ${h / 12}'`;
  const n = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2))));
  return `${n(w)}" × ${n(h)}"`;
}

export const sqft = (w: number | null | undefined, h: number | null | undefined) => (w && h ? (w * h) / 144 : 0);

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** The instant a shop-local day starts (handles CST/CDT). */
export function shopMidnight(ymd: string): Date {
  const noon = new Date(`${ymd}T12:00:00Z`);
  const local = new Date(noon.toLocaleString("en-US", { timeZone: SHOP_TZ }));
  const utc = new Date(noon.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + (utc.getTime() - local.getTime()));
}
