/**
 * Shop-time helpers for the equipment schedule. Blocks are stored as timestamptz; the board shows
 * them in shop time (America/Chicago). Every conversion goes through Intl, so days that are 23 or 25
 * hours long (daylight saving) come out right.
 *
 * Pure: safe on the client and the server (and in unit tests).
 */
import { SHOP_TZ, addDays } from "@/lib/format";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
/** Blocks snap to this many minutes when dragged, resized or auto-scheduled. */
export const SNAP_MINUTES = 15;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

type Local = { y: number; m: number; d: number; h: number; mi: number; s: number; wd: number };
function local(ms: number, tz: string): Local {
  const p: Record<string, string> = {};
  for (const x of partsFormatter(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour! % 24, mi: +p.minute!, s: +p.second!, wd: WEEKDAY_INDEX[p.weekday!] ?? 0 };
}

/** Minutes the zone is ahead of UTC at this instant (Chicago: −300 in summer, −360 in winter). */
export function tzOffsetMinutes(ms: number, tz = SHOP_TZ): number {
  const l = local(ms, tz);
  const asUtc = Date.UTC(l.y, l.m - 1, l.d, l.h, l.mi, l.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / MINUTE);
}

/**
 * The instant of a shop-local wall-clock time: `ymd` at `minuteOfDay` (may be ≥ 1440 for "the next
 * day"). A time skipped by spring-forward lands an hour later, like a wall clock would.
 */
export function zonedTime(ymd: string, minuteOfDay: number, tz = SHOP_TZ): number {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  const off1 = tzOffsetMinutes(naive, tz);
  let t = naive - off1 * MINUTE;
  const off2 = tzOffsetMinutes(t, tz);
  if (off2 !== off1) t = naive - off2 * MINUTE;
  return t;
}

/** Shop-local date, minute of the day and weekday (0 = Sunday) of an instant. */
export function localParts(ms: number, tz = SHOP_TZ): { ymd: string; minute: number; weekday: number } {
  const l = local(ms, tz);
  const ymd = `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;
  return { ymd, minute: l.h * 60 + l.mi, weekday: l.wd };
}

export const ymdAt = (ms: number, tz = SHOP_TZ) => localParts(ms, tz).ymd;

/** When a shop-local day starts and ends (23 h on spring-forward day, 25 h on fall-back day). */
export function dayBounds(ymd: string, tz = SHOP_TZ): { start: number; end: number } {
  return { start: zonedTime(ymd, 0, tz), end: zonedTime(addDays(ymd, 1), 0, tz) };
}

/** Day of the week of a YYYY-MM-DD date (0 = Sunday). */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Monday of the week containing `ymd` (the schedule's week runs Monday–Sunday). */
export function mondayOf(ymd: string): string {
  return addDays(ymd, -((weekdayOf(ymd) + 6) % 7));
}

/** Round an instant up / down / to the nearest snap step (Chicago's offset is whole hours, so UTC steps line up). */
export const snapUp = (ms: number, step = SNAP_MINUTES) => Math.ceil(ms / (step * MINUTE)) * step * MINUTE;
export const snapDown = (ms: number, step = SNAP_MINUTES) => Math.floor(ms / (step * MINUTE)) * step * MINUTE;
export const snapNearest = (ms: number, step = SNAP_MINUTES) => Math.round(ms / (step * MINUTE)) * step * MINUTE;
/** Whole snap steps, at least one: 7 → 15, 16 → 30. */
export const roundMinutes = (min: number, step = SNAP_MINUTES) => Math.max(step, Math.ceil(Math.round(min * 1000) / 1000 / step) * step);

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "9:00", "1:15 pm" style clock: 24 h is hard to read on the shop floor, so "9:00 am" / "1:15 pm". */
export function clock(minuteOfDay: number, opts: { suffix?: boolean } = {}): string {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mi = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const s = `${h12}:${String(mi).padStart(2, "0")}`;
  return opts.suffix === false ? s : `${s} ${h < 12 ? "am" : "pm"}`;
}

/** "9 am", "12 pm", "1:30 pm" — hour labels on the board. */
export function hourLabel(minuteOfDay: number): string {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m % 60 ? `:${String(m % 60).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}

/** "1 hr 15 min", "45 min", "2 hr". */
export function durationLabel(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

/** Hours with at most one decimal: 7.5, 8, 0.3. */
export const hoursLabel = (minutes: number) => String(Math.round((minutes / 60) * 10) / 10);

/**
 * "Tue 9:00–10:15 am", or across days "Tue 3:00 pm – Wed 9:30 am".
 * With `date`: "Tue, Sep 29, 9:00–10:15 am" (for history, where the week isn't obvious).
 */
export function rangeLabel(start: number, end: number, tz = SHOP_TZ, opts: { date?: boolean } = {}): string {
  const a = localParts(start, tz);
  const b = localParts(end, tz);
  const md = (ymd: string) => {
    const [, m, d] = ymd.split("-").map(Number) as [number, number, number];
    return `${MONTH_SHORT[m - 1]} ${d}`;
  };
  const day = opts.date ? `${WEEKDAY_SHORT[a.weekday]}, ${md(a.ymd)},` : WEEKDAY_SHORT[a.weekday];
  const endsAtMidnight = b.minute === 0 && end > start && localParts(end - 1, tz).ymd === a.ymd;
  if (a.ymd === b.ymd || endsAtMidnight) {
    const sameHalf = !endsAtMidnight && a.minute < 720 === b.minute < 720;
    return `${day} ${clock(a.minute, { suffix: !sameHalf })}–${clock(b.minute)}`;
  }
  const endDay = opts.date ? `${WEEKDAY_SHORT[b.weekday]}, ${md(b.ymd)},` : WEEKDAY_SHORT[b.weekday];
  return `${day} ${clock(a.minute)} – ${endDay} ${clock(b.minute)}`;
}

/** "Tue, Sep 29" for a YYYY-MM-DD. */
export function dayLabel(ymd: string, opts: { long?: boolean } = {}): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: opts.long ? "long" : "short",
    month: opts.long ? "long" : "short",
    day: "numeric",
  });
}

/** "HH:MM" for <input type="time"> from a minute of the day, and back. */
export const toTimeInput = (minuteOfDay: number) => `${String(Math.floor(minuteOfDay / 60) % 24).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
export function fromTimeInput(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
