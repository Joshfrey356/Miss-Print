/** Report date ranges (shop time). Pure; safe on client and server. */
import { addDays, fmtDate, today } from "@/lib/format";

export const RANGE_PRESETS = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "ytd", label: "Year to date" },
  { key: "last_12", label: "Last 12 months" },
  { key: "custom", label: "Custom" },
] as const;
export type RangeKey = (typeof RANGE_PRESETS)[number]["key"];
export type DateRange = { key: RangeKey; from: string; to: string; label: string };

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function resolveRange(sp: { range?: string; from?: string; to?: string }, now = today()): DateRange {
  const [y, m] = now.split("-").map(Number) as [number, number];
  const key = (RANGE_PRESETS.some((p) => p.key === sp.range) ? sp.range : "ytd") as RangeKey;
  let from: string;
  let to = now;
  switch (key) {
    case "this_month":
      from = ymd(y, m, 1);
      break;
    case "last_month":
      from = ymd(y, m - 1, 1);
      to = addDays(ymd(y, m, 1), -1);
      break;
    case "this_quarter":
      from = ymd(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
      break;
    case "last_12":
      from = ymd(y, m - 11, 1);
      break;
    case "custom": {
      from = isYmd(sp.from) ? sp.from : ymd(y, 1, 1);
      to = isYmd(sp.to) ? sp.to : now;
      if (from > to) [from, to] = [to, from];
      break;
    }
    default:
      from = ymd(y, 1, 1);
  }
  const preset = RANGE_PRESETS.find((p) => p.key === key)!;
  const label =
    key === "custom" ? `${fmtDate(from, { year: true, weekday: false })} – ${fmtDate(to, { year: true, weekday: false })}` : `${preset.label} (${fmtDate(from, { weekday: false })} – ${fmtDate(to, { year: true, weekday: false })})`;
  return { key, from, to, label };
}

/** Every "YYYY-MM" from `from` through `to`, so months with nothing still show. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export const monthLabel = (ym: string, withYear = false) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: withYear ? "numeric" : undefined });
};

export function rangeQuery(r: DateRange): Record<string, string> {
  return r.key === "custom" ? { range: "custom", from: r.from, to: r.to } : { range: r.key };
}
