/**
 * Calendar item shapes, types, colors and date helpers. Pure — safe on client and server.
 */
import type { EventType } from "@/lib/db/schema";
import { addDays, SHOP_TZ } from "@/lib/format";

export type CalType = "due" | "install" | "delivery" | "pickup" | "deadline" | "reminder" | "other";

/** Order = legend order. Class names are literal so Tailwind picks them up. */
export const CAL_TYPES: { key: CalType; label: string; dot: string; chip: string }[] = [
  { key: "due", label: "Job due", dot: "bg-brand-500", chip: "border-brand-500 bg-brand-50 text-brand-900" },
  { key: "install", label: "Install", dot: "bg-violet-500", chip: "border-violet-500 bg-violet-50 text-violet-900" },
  { key: "delivery", label: "Delivery", dot: "bg-orange-500", chip: "border-orange-500 bg-orange-50 text-orange-900" },
  { key: "pickup", label: "Pickup", dot: "bg-emerald-500", chip: "border-emerald-500 bg-emerald-50 text-emerald-900" },
  { key: "deadline", label: "Deadline", dot: "bg-rose-500", chip: "border-rose-500 bg-rose-50 text-rose-900" },
  { key: "reminder", label: "Reminder", dot: "bg-amber-400", chip: "border-amber-400 bg-amber-50 text-amber-900" },
  { key: "other", label: "Other", dot: "bg-slate-400", chip: "border-slate-400 bg-slate-100 text-slate-800" },
];
export const calType = (k: CalType) => CAL_TYPES.find((t) => t.key === k)!;

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  install: "Installation",
  delivery: "Delivery",
  pickup: "Pickup",
  deadline: "Deadline",
  reminder: "Reminder",
  other: "Other",
};

/** A custom calendar_events row, in the shape the edit dialog needs. */
export type EditableEvent = {
  id: number;
  title: string;
  type: EventType;
  date: string; // YYYY-MM-DD (shop time)
  allDay: boolean;
  startTime: string | null; // "HH:MM"
  endTime: string | null;
  jobNumber: number | null;
  locationId: number | null;
  userId: number | null;
  notes: string | null;
};

export type CalItem = {
  key: string;
  kind: "job_due" | "fulfillment" | "event";
  type: CalType;
  title: string;
  subtitle: string | null;
  date: string; // YYYY-MM-DD (shop time)
  time: string | null; // "9:30 AM" — null = all day
  endTime: string | null;
  sort: number; // minutes after midnight; -1 for all-day
  href: string | null; // jobs link to the job; custom events open the dialog
  jobNumber: number | null;
  overdue: boolean;
  mine: boolean;
  locationCode: string | null;
  locationName: string | null;
  event?: EditableEvent;
};

export type CalView = "day" | "week" | "month";

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
const parts = (ymd: string) => ymd.split("-").map(Number) as [number, number, number];

/** 0 = Sunday */
export const weekday = (ymd: string) => {
  const [y, m, d] = parts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
export const startOfWeek = (ymd: string) => addDays(ymd, -weekday(ymd));
export const startOfMonth = (ymd: string) => ymd.slice(0, 8) + "01";
export function addMonths(ymd: string, n: number) {
  const [y, m] = parts(ymd);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return dt.toISOString().slice(0, 10);
}
export const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** The dates a view covers (month = the full Sunday–Saturday grid). */
export function viewRange(view: CalView, date: string): { from: string; to: string } {
  if (view === "day") return { from: date, to: date };
  if (view === "week") {
    const from = startOfWeek(date);
    return { from, to: addDays(from, 6) };
  }
  const first = startOfMonth(date);
  const last = addDays(addMonths(first, 1), -1);
  return { from: startOfWeek(first), to: addDays(startOfWeek(last), 6) };
}

const fmt = (ymd: string, o: Intl.DateTimeFormatOptions) => {
  const [y, m, d] = parts(ymd);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { timeZone: "UTC", ...o });
};
export const monthTitle = (ymd: string) => fmt(ymd, { month: "long", year: "numeric" });
export const longDay = (ymd: string) => fmt(ymd, { weekday: "long", month: "long", day: "numeric" });
export const shortDay = (ymd: string) => fmt(ymd, { weekday: "short", month: "short", day: "numeric" });
export function weekTitle(from: string) {
  const to = addDays(from, 6);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `${fmt(from, { month: "short", day: "numeric" })} – ${sameMonth ? fmt(to, { day: "numeric" }) : fmt(to, { month: "short", day: "numeric" })}, ${to.slice(0, 4)}`;
}

// ---------------------------------------------------------------------------
// Shop-time conversions
// ---------------------------------------------------------------------------
function tzOffsetMs(t: number, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(t / 1000) * 1000;
}

/** "2026-09-25" + "09:30" in shop time → the UTC instant. */
export function shopTimeToDate(ymd: string, hm: string, tz = SHOP_TZ): Date {
  const [y, m, d] = parts(ymd);
  const [h, mi] = hm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off1 = tzOffsetMs(guess, tz);
  let t = guess - off1;
  const off2 = tzOffsetMs(t, tz);
  if (off2 !== off1) t = guess - off2;
  return new Date(t);
}

/** "HH:MM" (24h) of an instant in shop time. */
export function shopHM(d: Date | string, tz = SHOP_TZ) {
  return new Date(d).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
