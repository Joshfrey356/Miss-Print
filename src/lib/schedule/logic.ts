/**
 * Equipment scheduling: how long a job's work takes on which machine, when a machine is free,
 * and what's wrong with a booking (double-booked, over capacity, outside working hours, late).
 *
 * Pure: safe on the client and the server (and in unit tests). Times are epoch milliseconds;
 * days are shop-local YYYY-MM-DD strings (see ./time).
 */
import { SHOP_TZ, addDays, fmtDate } from "@/lib/format";
import { HOUR, MINUTE, WEEKDAY_LONG, WEEKDAY_SHORT, clock, dayBounds, durationLabel, hoursLabel, localParts, roundMinutes, snapUp, weekdayOf, ymdAt, zonedTime } from "./time";

export type MachineKind = "digital" | "offset" | "wide_format" | "cutter" | "folder" | "bindery" | "other";
export type BlockStatus = "scheduled" | "running" | "done";
export type Priority = "normal" | "rush" | "critical";

export type SchedMachine = {
  id: number;
  name: string;
  kind: MachineKind;
  /** Hours the machine runs on a work day. */
  hoursPerDay: number;
  /** 0 = Sunday … 6 = Saturday. */
  workDays: number[];
  /** Digital: setup per job. Offset: make-ready per plate. Minutes. */
  setupMinutes: number;
};

export type Span = { start: number; end: number };
export type BusyBlock = Span & { id?: number; equipmentId: number; jobId?: number | null; jobItemId?: number | null };

/** Work days start at 8:00 shop time (no per-machine start time yet). Machines running 16+ hours start earlier. */
export const DAY_START_MINUTE = 8 * 60;
/** Service without a time estimate (cutting, folding): this long. */
export const DEFAULT_SERVICE_MINUTES = 15;
/** Line with no estimate at all: a 1-hour block the person can adjust. */
export const DEFAULT_GUESS_MINUTES = 60;

// ---------------------------------------------------------------------------
// Working hours
// ---------------------------------------------------------------------------

/** Shop-local minutes a machine runs on a work day: 8:00 + hours per day (kept inside the day). */
export function workMinutes(m: Pick<SchedMachine, "hoursPerDay">): { from: number; to: number } | null {
  const h = Math.min(24, Math.max(0, Number(m.hoursPerDay) || 0));
  if (h <= 0) return null;
  const len = Math.round(h * 60);
  const from = Math.min(DAY_START_MINUTE, 1440 - len);
  return { from, to: from + len };
}

export const isWorkDay = (m: Pick<SchedMachine, "workDays">, ymd: string) => (m.workDays ?? []).includes(weekdayOf(ymd));

/** When the machine runs on that day, or null when it doesn't run. */
export function workWindow(m: Pick<SchedMachine, "hoursPerDay" | "workDays">, ymd: string, tz = SHOP_TZ): Span | null {
  if (!isWorkDay(m, ymd)) return null;
  const w = workMinutes(m);
  if (!w) return null;
  return { start: zonedTime(ymd, w.from, tz), end: zonedTime(ymd, w.to, tz) };
}

/** Minutes of machine time available that day (0 on days off). */
export function capacityMinutes(m: Pick<SchedMachine, "hoursPerDay" | "workDays">, ymd: string, tz = SHOP_TZ): number {
  const w = workWindow(m, ymd, tz);
  return w ? Math.round((w.end - w.start) / MINUTE) : 0;
}

/** "Mon–Fri", "Mon–Sat", "Mon, Wed, Fri", "Every day", "No days". */
export function workDaysLabel(days: number[]): string {
  const s = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (!s.length) return "No days";
  if (s.length === 7) return "Every day";
  // A run of consecutive days (Mon–Fri) reads best as a range.
  const run = s.every((d, i) => i === 0 || d === s[i - 1]! + 1);
  if (run && s.length >= 3) return `${WEEKDAY_SHORT[s[0]!]}–${WEEKDAY_SHORT[s[s.length - 1]!]}`;
  return s.map((d) => WEEKDAY_SHORT[d]).join(", ");
}

/** "8 hr · Mon–Fri · 8:00 am–4:00 pm" */
export function capacityLabel(m: Pick<SchedMachine, "hoursPerDay" | "workDays">): string {
  const w = workMinutes(m);
  if (!w || !m.workDays.length) return "Not scheduled";
  return `${hoursLabel(w.to - w.from)} hr · ${workDaysLabel(m.workDays)} · ${clock(w.from)}–${clock(w.to)}`;
}

// ---------------------------------------------------------------------------
// Work to schedule: how long, on which machine
// ---------------------------------------------------------------------------
export type Stage = "press" | "cutter" | "folder" | "bindery" | "other";
export const stageOf = (kind: MachineKind): Stage =>
  kind === "digital" || kind === "offset" || kind === "wide_format" ? "press" : kind === "cutter" || kind === "folder" || kind === "bindery" ? kind : "other";

export type OpInfo = {
  id: number;
  name: string;
  basis: "per_job" | "per_piece" | "per_1000" | "per_sheet" | "per_hour";
  piecesPerHour: number | null;
  equipmentId: number | null;
};

export type ItemInfo = {
  id: number;
  jobId: number;
  quantity: number;
  description: string;
  categoryName?: string | null;
  /** Category group: print | sign | wrap | design | other. */
  categoryGroup?: string | null;
  pricingMethod?: string | null;
  pricingInput: unknown;
  pricingBreakdown: unknown;
};

export type WorkPiece = {
  /** Stable per job line: "802:press", "802:m3" (service on machine 3), "802:guess". */
  key: string;
  jobId: number;
  jobItemId: number;
  equipmentId: number | null;
  stage: Stage;
  minutes: number;
  /** What's done: "Print", "Cutting, Round corners". */
  label: string;
  /** estimate = from the print estimate; service = a bindery service; guess = no estimate. */
  source: "estimate" | "service" | "guess";
  /** Plain words: how the time was worked out. */
  detail: string;
};

type Production = { pressId?: number; runHours?: number; plates?: number; pressSheets?: number; services?: string[] };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const numOr = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Lines that are people's time, not machine time. */
const NOT_MACHINE_WORK = /\b(install(ation|ing|ers?)?|graphic design|design (time|fee|work)|delivery|shipping|freight|rush fee|site survey|removal|permit|consultation)\b/i;
export function isMachineWork(item: Pick<ItemInfo, "description" | "categoryName" | "categoryGroup">): boolean {
  if (NOT_MACHINE_WORK.test(item.description)) return false;
  if (item.categoryGroup === "design") return false;
  if (item.categoryName && /\b(graphic )?design\b|\binstall/i.test(item.categoryName)) return false;
  return true;
}

function firstOf(machines: SchedMachine[], ...kinds: MachineKind[]): SchedMachine | undefined {
  for (const k of kinds) {
    const m = machines.find((x) => x.kind === k);
    if (m) return m;
  }
  return undefined;
}

/** Best guess of the machine for a line that has no print estimate. */
export function guessMachine(pricingMethod: string | null | undefined, machines: SchedMachine[]): SchedMachine | undefined {
  if (pricingMethod === "per_sqft" || pricingMethod === "per_unit") return firstOf(machines, "wide_format", "digital", "offset") ?? machines[0];
  return firstOf(machines, "digital", "offset", "wide_format") ?? machines[0];
}

/**
 * The machine work one job line needs. Print-estimated lines: press time (run + setup; offset
 * make-ready is per plate) and their services on bindery machines. Other lines: a 1-hour guess on the
 * likeliest machine. `machines` are the shop's active machines.
 */
export function workForItem(item: ItemInfo, machines: SchedMachine[], ops: OpInfo[]): WorkPiece[] {
  if (!isMachineWork(item) || !machines.length) return [];
  const byId = new Map(machines.map((m) => [m.id, m]));
  const prod = obj(obj(item.pricingBreakdown)?.production) as Production | null;
  const base = { jobId: item.jobId, jobItemId: item.id };
  const out: WorkPiece[] = [];

  if (!prod || !prod.pressId) {
    const m = guessMachine(item.pricingMethod, machines);
    return [
      {
        ...base,
        key: `${item.id}:guess`,
        equipmentId: m?.id ?? null,
        stage: m ? stageOf(m.kind) : "press",
        minutes: DEFAULT_GUESS_MINUTES,
        label: m && stageOf(m.kind) !== "press" ? "Production" : "Print",
        source: "guess",
        detail: "No time estimate on this line, so it starts as 1 hour. Change it to fit.",
      },
    ];
  }

  // ---- Press ----
  const press = byId.get(prod.pressId) ?? firstOf(machines, "digital", "offset");
  const runMin = Math.max(0, numOr(prod.runHours, 0) * 60);
  let setupMin = 0;
  let setupText = "";
  if (press?.kind === "offset") {
    const plates = Math.max(0, Math.round(numOr(prod.plates, 0)));
    setupMin = press.setupMinutes * plates;
    if (setupMin) setupText = ` + make-ready ${durationLabel(setupMin)} (${plates} plate${plates === 1 ? "" : "s"} × ${press.setupMinutes} min)`;
  } else if (press) {
    setupMin = press.setupMinutes;
    if (setupMin) setupText = ` + setup ${durationLabel(setupMin)}`;
  }
  out.push({
    ...base,
    key: `${item.id}:press`,
    equipmentId: press?.id ?? null,
    stage: "press",
    minutes: roundMinutes(runMin + setupMin),
    label: "Print",
    source: "estimate",
    detail: `From the estimate: run ${durationLabel(Math.max(1, Math.round(runMin)))}${setupText}${press && press.id !== prod.pressId ? " (estimated press is off)" : ""}`,
  });

  // ---- Services on machines ----
  const input = obj(obj(item.pricingInput)?.print);
  const ids = Array.isArray(input?.operationIds) ? (input!.operationIds as unknown[]).filter((x): x is number => typeof x === "number") : null;
  const picked = ids ? ops.filter((o) => ids.includes(o.id)) : ops.filter((o) => (prod.services ?? []).includes(o.name));
  const perMachine = new Map<number, { names: string[]; minutes: number; notes: string[] }>();
  for (const op of picked) {
    let m = op.equipmentId ? byId.get(op.equipmentId) : undefined;
    if (!m && !op.equipmentId) {
      if (/\b(cut|cutting|trim)/i.test(op.name)) m = firstOf(machines, "cutter");
      else if (/\bfold/i.test(op.name)) m = firstOf(machines, "folder");
    }
    if (!m) continue;
    let minutes = DEFAULT_SERVICE_MINUTES;
    let note = `${op.name} about ${DEFAULT_SERVICE_MINUTES} min`;
    if (op.basis === "per_hour" && op.piecesPerHour && op.piecesPerHour > 0) {
      const count = Math.max(1, item.quantity);
      minutes = (count / op.piecesPerHour) * 60;
      note = `${op.name}: ${count.toLocaleString("en-US")} at ${op.piecesPerHour.toLocaleString("en-US")}/hr`;
    }
    const cur = perMachine.get(m.id) ?? { names: [], minutes: 0, notes: [] };
    cur.names.push(op.name);
    cur.minutes += minutes;
    cur.notes.push(note);
    perMachine.set(m.id, cur);
  }
  for (const [mid, s] of perMachine) {
    const m = byId.get(mid)!;
    out.push({
      ...base,
      key: `${item.id}:m${mid}`,
      equipmentId: mid,
      stage: stageOf(m.kind),
      minutes: roundMinutes(s.minutes),
      label: s.names.join(", "),
      source: "service",
      detail: s.notes.join(" · "),
    });
  }
  return out;
}

/** The step a booking is for, from its title: "Print · 500 cards" → "Print", "Cutting (part 1 of 2) · …" → "Cutting". */
export const stepOfTitle = (title: string) => title.split(" · ")[0]!.replace(/ \(part \d+ of \d+\)$/, "").trim();

/**
 * Work that isn't booked yet. A booking counts for a piece when it's for the same job line and the
 * same step (its title), wherever it was moved; else the same machine, or a machine of the same kind
 * of step (moving a print block from the digital press to the offset press keeps it scheduled).
 */
export function unscheduledWork<P extends WorkPiece>(pieces: P[], blocks: (Pick<BusyBlock, "equipmentId" | "jobItemId"> & { title?: string | null })[], machineKinds: Map<number, MachineKind>): P[] {
  const pool = blocks.filter((b) => b.jobItemId != null).map((b) => ({ ...b, used: false }));
  const taken = new Set<P>();
  // Same step first, then exact machine, then same stage, so one block never covers two pieces.
  for (const p of pieces) {
    const b = pool.find((x) => !x.used && x.jobItemId === p.jobItemId && x.title != null && stepOfTitle(x.title) === p.label);
    if (b) {
      b.used = true;
      taken.add(p);
    }
  }
  for (const p of pieces) {
    if (taken.has(p)) continue;
    const b = pool.find((x) => !x.used && x.jobItemId === p.jobItemId && x.equipmentId === p.equipmentId);
    if (b) {
      b.used = true;
      taken.add(p);
    }
  }
  for (const p of pieces) {
    if (taken.has(p)) continue;
    const b = pool.find((x) => {
      if (x.used || x.jobItemId !== p.jobItemId) return false;
      const k = machineKinds.get(x.equipmentId);
      return k ? stageOf(k) === p.stage : false;
    });
    if (b) {
      b.used = true;
      taken.add(p);
    }
  }
  return pieces.filter((p) => !taken.has(p));
}

// ---------------------------------------------------------------------------
// Free time
// ---------------------------------------------------------------------------

/** Free stretches of `span` not covered by `busy`. */
export function freeIntervals(span: Span, busy: Span[]): Span[] {
  const sorted = busy.filter((b) => b.end > span.start && b.start < span.end).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  let cur = span.start;
  for (const b of sorted) {
    if (b.start > cur) out.push({ start: cur, end: Math.min(b.start, span.end) });
    cur = Math.max(cur, b.end);
    if (cur >= span.end) break;
  }
  if (cur < span.end) out.push({ start: cur, end: span.end });
  return out.filter((s) => s.end > s.start);
}

/**
 * The first time the machine is free for `minutes`, within its working hours and days, not before
 * `earliest`. Work longer than a whole work day is split over the next free stretches (at least 30
 * minutes each). Returns the booked pieces, or null when nothing fits in `maxDays`.
 */
export function firstFreeSlot(
  machine: Pick<SchedMachine, "hoursPerDay" | "workDays">,
  busy: Span[],
  minutes: number,
  earliest: number,
  opts: { maxDays?: number; tz?: string } = {},
): Span[] | null {
  const tz = opts.tz ?? SHOP_TZ;
  const maxDays = opts.maxDays ?? 60;
  const need = Math.max(1, Math.round(minutes)) * MINUTE;
  const wm = workMinutes(machine);
  if (!wm || !machine.workDays.length) return null;
  const dayLen = (wm.to - wm.from) * MINUTE;
  const from = snapUp(earliest);
  const split = need > dayLen;
  const segments: Span[] = [];
  let left = need;
  let ymd = localParts(from, tz).ymd;
  for (let i = 0; i < maxDays; i++, ymd = addDays(ymd, 1)) {
    const w = workWindow(machine, ymd, tz);
    if (!w || w.end <= from) continue;
    const span = { start: Math.max(w.start, from), end: w.end };
    for (const f of freeIntervals(span, busy)) {
      const start = snapUp(f.start);
      const len = f.end - start;
      if (!split) {
        if (len >= need) return [{ start, end: start + need }];
        continue;
      }
      if (len < 30 * MINUTE && len < left) continue;
      const take = Math.min(len, left);
      segments.push({ start, end: start + take });
      left -= take;
      if (left <= 0) return segments;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Auto-schedule
// ---------------------------------------------------------------------------
export type WaitingPiece = WorkPiece & { jobNumber: number; dueDate: string | null; priority: Priority };
export type Proposal<P extends WaitingPiece = WaitingPiece> = { piece: P; equipmentId: number; segments: Span[] };

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, rush: 1, normal: 2 };

/** Order for auto-scheduling: earliest due date, then critical/rush first, then job number. Pieces of a line keep their order. */
export function scheduleOrder<P extends WaitingPiece>(pieces: P[]): P[] {
  return pieces
    .map((p, i) => ({ p, i }))
    .sort(
      (a, b) =>
        (a.p.dueDate ?? "9999-12-31").localeCompare(b.p.dueDate ?? "9999-12-31") ||
        PRIORITY_RANK[a.p.priority] - PRIORITY_RANK[b.p.priority] ||
        a.p.jobNumber - b.p.jobNumber ||
        a.i - b.i,
    )
    .map((x) => x.p);
}

/**
 * Book every waiting piece into the first free time on its machine, in schedule order. Finishing
 * (cutting, folding…) waits until the line's printing is done. Nothing is saved: this is the preview.
 */
export function autoSchedule<P extends WaitingPiece>(
  pieces: P[],
  machines: SchedMachine[],
  blocks: BusyBlock[],
  now: number,
  opts: { tz?: string; maxDays?: number } = {},
): { proposals: Proposal<P>[]; skipped: { piece: P; reason: string }[] } {
  const byId = new Map(machines.map((m) => [m.id, m]));
  const busy = new Map<number, Span[]>();
  for (const b of blocks) busy.set(b.equipmentId, [...(busy.get(b.equipmentId) ?? []), b]);
  // When each line's printing ends (booked already or in this run).
  const printedAt = new Map<number, number>();
  for (const b of blocks) {
    const m = byId.get(b.equipmentId);
    if (b.jobItemId != null && m && stageOf(m.kind) === "press") printedAt.set(b.jobItemId, Math.max(printedAt.get(b.jobItemId) ?? 0, b.end));
  }
  const proposals: Proposal<P>[] = [];
  const skipped: { piece: P; reason: string }[] = [];
  for (const p of scheduleOrder(pieces)) {
    const m = p.equipmentId != null ? byId.get(p.equipmentId) : undefined;
    if (!m) {
      skipped.push({ piece: p, reason: "No machine picked" });
      continue;
    }
    const earliest = p.stage === "press" ? now : Math.max(now, printedAt.get(p.jobItemId) ?? 0);
    const segs = firstFreeSlot(m, busy.get(m.id) ?? [], p.minutes, earliest, opts);
    if (!segs) {
      skipped.push({ piece: p, reason: `${m.name} has no free time in the next ${opts.maxDays ?? 60} days` });
      continue;
    }
    proposals.push({ piece: p, equipmentId: m.id, segments: segs });
    busy.set(m.id, [...(busy.get(m.id) ?? []), ...segs]);
    if (p.stage === "press") printedAt.set(p.jobItemId, Math.max(printedAt.get(p.jobItemId) ?? 0, segs[segs.length - 1]!.end));
  }
  return { proposals, skipped };
}

// ---------------------------------------------------------------------------
// Load and warnings
// ---------------------------------------------------------------------------
const overlapMs = (a: Span, b: Span) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/** Minutes booked on the machine that shop day vs. what it can run. */
export function dayLoad(machine: SchedMachine, blocks: BusyBlock[], ymd: string, tz = SHOP_TZ): { booked: number; capacity: number } {
  const day = dayBounds(ymd, tz);
  const booked = blocks.filter((b) => b.equipmentId === machine.id).reduce((s, b) => s + overlapMs(b, day), 0);
  return { booked: Math.round(booked / MINUTE), capacity: capacityMinutes(machine, ymd, tz) };
}

export type IssueKind = "overlap" | "capacity" | "off_hours" | "day_off" | "late";
export type Issue = { kind: IssueKind; text: string; withIds?: number[] };

/** Shop-local days a span touches. */
export function daysOf(span: Span, tz = SHOP_TZ): string[] {
  const out: string[] = [];
  let ymd = ymdAt(span.start, tz);
  const last = ymdAt(Math.max(span.start, span.end - 1), tz);
  for (let i = 0; i < 400; i++) {
    out.push(ymd);
    if (ymd >= last) break;
    ymd = addDays(ymd, 1);
  }
  return out;
}

/**
 * What's wrong with a booking. `blocks` is everything booked (the block itself may be in it: it's
 * matched by id). Saving is still allowed — these are shown as warnings.
 */
export function blockIssues(
  b: Span & { id?: number; equipmentId: number; dueDate?: string | null },
  machine: SchedMachine | undefined,
  blocks: BusyBlock[],
  tz = SHOP_TZ,
): Issue[] {
  const issues: Issue[] = [];
  const others = blocks.filter((o) => o.equipmentId === b.equipmentId && (b.id == null || o.id !== b.id));
  const clashes = others.filter((o) => o.start < b.end && o.end > b.start);
  if (clashes.length)
    issues.push({
      kind: "overlap",
      text: clashes.length === 1 ? "Double-booked: overlaps another booking on this machine" : `Double-booked: overlaps ${clashes.length} other bookings on this machine`,
      withIds: clashes.map((c) => c.id).filter((x): x is number => x != null),
    });
  if (machine) {
    const wm = workMinutes(machine);
    for (const ymd of daysOf(b, tz)) {
      const w = workWindow(machine, ymd, tz);
      const day = dayBounds(ymd, tz);
      const part = { start: Math.max(b.start, day.start), end: Math.min(b.end, day.end) };
      if (part.end <= part.start) continue;
      if (!w) {
        issues.push({ kind: "day_off", text: `${machine.name} doesn't run on ${WEEKDAY_LONG[weekdayOf(ymd)]}s` });
        continue;
      }
      if (part.start < w.start || part.end > w.end)
        issues.push({ kind: "off_hours", text: `Outside working hours (${clock(wm!.from)}–${clock(wm!.to)})` });
      const all = [...others, { ...b, equipmentId: machine.id }];
      const booked = all.reduce((s, o) => s + overlapMs(o, day), 0) / MINUTE;
      const cap = (w.end - w.start) / MINUTE;
      if (booked > cap + 0.5) issues.push({ kind: "capacity", text: `Over capacity on ${WEEKDAY_SHORT[weekdayOf(ymd)]}: ${hoursLabel(booked)} of ${hoursLabel(cap)} hr booked` });
    }
  }
  if (b.dueDate && ymdAt(b.end - 1, tz) > b.dueDate) issues.push({ kind: "late", text: `Ends after the job is due (${fmtDate(b.dueDate)})` });
  // One line per kind is enough.
  const seen = new Set<string>();
  return issues.filter((i) => (seen.has(i.kind + i.text) ? false : (seen.add(i.kind + i.text), true)));
}

/** Check a booking before saving: sensible length, not absurdly long. Returns an error message or null. */
export function spanError(start: number, end: number): string | null {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "Pick a start date and time.";
  if (end <= start) return "The booking needs a length of at least 15 minutes.";
  if (end - start > 14 * 24 * HOUR) return "A booking can be at most 2 weeks long. Split longer work into several bookings.";
  return null;
}
