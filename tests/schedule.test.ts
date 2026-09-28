import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoSchedule,
  blockIssues,
  capacityLabel,
  dayLoad,
  firstFreeSlot,
  freeIntervals,
  isMachineWork,
  scheduleOrder,
  stepOfTitle,
  unscheduledWork,
  workDaysLabel,
  workForItem,
  workWindow,
  type BusyBlock,
  type ItemInfo,
  type OpInfo,
  type SchedMachine,
  type WaitingPiece,
} from "../src/lib/schedule/logic";
import { dayBounds, durationLabel, fromTimeInput, localParts, mondayOf, rangeLabel, roundMinutes, tzOffsetMinutes, zonedTime, HOUR, MINUTE } from "../src/lib/schedule/time";

const TZ = "America/Chicago";
const at = (ymd: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedTime(ymd, h! * 60 + m!, TZ);
};
const hhmm = (ms: number) => {
  const p = localParts(ms, TZ);
  return `${p.ymd} ${String(Math.floor(p.minute / 60)).padStart(2, "0")}:${String(p.minute % 60).padStart(2, "0")}`;
};

const digital: SchedMachine = { id: 1, name: "Digital color press", kind: "digital", hoursPerDay: 8, workDays: [1, 2, 3, 4, 5], setupMinutes: 5 };
const offset: SchedMachine = { id: 2, name: "Offset press", kind: "offset", hoursPerDay: 8, workDays: [1, 2, 3, 4, 5], setupMinutes: 15 };
const cutter: SchedMachine = { id: 3, name: "Guillotine cutter", kind: "cutter", hoursPerDay: 8, workDays: [1, 2, 3, 4, 5], setupMinutes: 0 };
const folder: SchedMachine = { id: 4, name: "Folder", kind: "folder", hoursPerDay: 8, workDays: [1, 2, 3, 4, 5], setupMinutes: 0 };
const wide: SchedMachine = { id: 5, name: "Latex 365", kind: "wide_format", hoursPerDay: 10, workDays: [1, 2, 3, 4, 5, 6], setupMinutes: 0 };
const machines = [digital, offset, cutter, folder];

const ops: OpInfo[] = [
  { id: 2, name: "Cutting", basis: "per_1000", piecesPerHour: null, equipmentId: 3 },
  { id: 3, name: "Folding", basis: "per_1000", piecesPerHour: null, equipmentId: 4 },
  { id: 6, name: "Padding", basis: "per_1000", piecesPerHour: null, equipmentId: null },
  { id: 7, name: "Saddle stitching", basis: "per_hour", piecesPerHour: 400, equipmentId: 4 },
  { id: 9, name: "Round corners", basis: "per_1000", piecesPerHour: null, equipmentId: 3 },
];

const item = (over: Partial<ItemInfo>): ItemInfo => ({ id: 10, jobId: 100, quantity: 500, description: "500 business cards", pricingInput: null, pricingBreakdown: null, ...over });

// ---------------------------------------------------------------------------
// Time zone & DST
// ---------------------------------------------------------------------------
test("zonedTime converts shop wall-clock time to the right instant in summer and winter", () => {
  assert.equal(new Date(at("2026-09-29", "09:00")).toISOString(), "2026-09-29T14:00:00.000Z"); // CDT, UTC−5
  assert.equal(new Date(at("2026-12-01", "09:00")).toISOString(), "2026-12-01T15:00:00.000Z"); // CST, UTC−6
  assert.equal(tzOffsetMinutes(Date.parse("2026-07-01T12:00:00Z"), TZ), -300);
  assert.equal(tzOffsetMinutes(Date.parse("2026-01-01T12:00:00Z"), TZ), -360);
});

test("DST days are 23 and 25 hours long; midnight boundaries stay local", () => {
  const spring = dayBounds("2026-03-08", TZ);
  assert.equal((spring.end - spring.start) / HOUR, 23);
  assert.equal(new Date(spring.start).toISOString(), "2026-03-08T06:00:00.000Z");
  const fall = dayBounds("2026-11-01", TZ);
  assert.equal((fall.end - fall.start) / HOUR, 25);
  assert.equal(new Date(fall.end).toISOString(), "2026-11-02T06:00:00.000Z");
  // A normal day
  const d = dayBounds("2026-09-29", TZ);
  assert.equal((d.end - d.start) / HOUR, 24);
});

test("8:00 work day windows are 8 hours long on both sides of a DST change", () => {
  for (const ymd of ["2026-10-30", "2026-11-02", "2026-03-06", "2026-03-09"]) {
    const w = workWindow(digital, ymd, TZ)!;
    assert.ok(w, ymd);
    assert.equal((w.end - w.start) / HOUR, 8, ymd);
    assert.equal(hhmm(w.start), `${ymd} 08:00`);
    assert.equal(hhmm(w.end), `${ymd} 16:00`);
  }
  assert.equal(workWindow(digital, "2026-11-01", TZ), null); // Sunday
});

test("localParts and mondayOf", () => {
  const p = localParts(Date.parse("2026-11-01T07:30:00Z"), TZ); // 1:30 CST (second 1:30 of the day)
  assert.equal(p.ymd, "2026-11-01");
  assert.equal(p.minute, 90);
  assert.equal(p.weekday, 0);
  assert.equal(mondayOf("2026-09-28"), "2026-09-28");
  assert.equal(mondayOf("2026-10-04"), "2026-09-28");
  assert.equal(mondayOf("2026-10-03"), "2026-09-28");
});

test("labels", () => {
  assert.equal(durationLabel(75), "1 hr 15 min");
  assert.equal(durationLabel(45), "45 min");
  assert.equal(durationLabel(120), "2 hr");
  assert.equal(rangeLabel(at("2026-09-29", "09:00"), at("2026-09-29", "10:15"), TZ), "Tue 9:00–10:15 am");
  assert.equal(rangeLabel(at("2026-09-29", "11:30"), at("2026-09-29", "13:00"), TZ), "Tue 11:30 am–1:00 pm");
  assert.equal(rangeLabel(at("2026-09-29", "15:00"), at("2026-09-30", "09:30"), TZ), "Tue 3:00 pm – Wed 9:30 am");
  assert.equal(workDaysLabel([1, 2, 3, 4, 5]), "Mon–Fri");
  assert.equal(workDaysLabel([1, 3, 5]), "Mon, Wed, Fri");
  assert.equal(workDaysLabel([0, 1, 2, 3, 4, 5, 6]), "Every day");
  assert.equal(capacityLabel(digital), "8 hr · Mon–Fri · 8:00 am–4:00 pm");
  assert.equal(capacityLabel({ hoursPerDay: 24, workDays: [1, 2] }), "24 hr · Mon, Tue · 12:00 am–12:00 am");
  assert.equal(fromTimeInput("09:15"), 555);
  assert.equal(fromTimeInput("25:00"), null);
  assert.equal(roundMinutes(7), 15);
  assert.equal(roundMinutes(16), 30);
  assert.equal(roundMinutes(30), 30);
});

// ---------------------------------------------------------------------------
// How long, on which machine
// ---------------------------------------------------------------------------
test("digital press work: run time + setup per job, rounded up to 15 minutes; services on the cutter", () => {
  const pieces = workForItem(
    item({
      pricingBreakdown: { production: { pressId: 1, runHours: 0.33, plates: 0, services: ["Cutting", "Round corners"] } },
      pricingInput: { print: { operationIds: [2, 9, 6] } },
    }),
    machines,
    ops,
  );
  assert.equal(pieces.length, 2);
  const [press, cut] = pieces;
  assert.equal(press!.equipmentId, 1);
  assert.equal(press!.minutes, 30); // 19.8 min run + 5 min setup → 30
  assert.equal(press!.source, "estimate");
  assert.match(press!.detail, /setup 5 min/);
  assert.equal(cut!.equipmentId, 3);
  assert.equal(cut!.label, "Cutting, Round corners"); // both on the cutter, padding has no machine
  assert.equal(cut!.minutes, 30);
  assert.equal(cut!.key, "10:m3");
});

test("offset press work: make-ready per plate", () => {
  const [press] = workForItem(item({ pricingBreakdown: { production: { pressId: 2, runHours: 1.2, plates: 8 } } }), machines, ops);
  assert.equal(press!.equipmentId, 2);
  // 72 min run + 8 × 15 = 120 min make-ready = 192 → 195
  assert.equal(press!.minutes, 195);
  assert.match(press!.detail, /8 plates × 15 min/);
});

test("per-hour services use pieces per hour; services found by name when choices weren't saved", () => {
  const pieces = workForItem(
    item({ quantity: 1000, pricingBreakdown: { production: { pressId: 1, runHours: 0.1, services: ["Saddle stitching", "Folding"] } } }),
    machines,
    ops,
  );
  const fold = pieces.find((p) => p.equipmentId === 4)!;
  // Saddle stitching 1000/400 = 150 min + folding 15 min
  assert.equal(fold.minutes, 165);
  assert.equal(fold.label, "Folding, Saddle stitching"); // catalog order
});

test("a service with no machine uses the cutter/folder when the name says so", () => {
  const pieces = workForItem(
    item({ pricingBreakdown: { production: { pressId: 1, runHours: 0.1 } }, pricingInput: { print: { operationIds: [50] } } }),
    machines,
    [{ id: 50, name: "Trim to size", basis: "per_job", piecesPerHour: null, equipmentId: null }],
  );
  assert.equal(pieces.length, 2);
  assert.equal(pieces[1]!.equipmentId, 3);
  assert.equal(pieces[1]!.minutes, 15);
});

test("a line without an estimate is a 1-hour guess on the likeliest machine", () => {
  const [banner] = workForItem(item({ description: "4' × 8' banner", pricingMethod: "per_sqft" }), [...machines, wide], ops);
  assert.equal(banner!.equipmentId, 5);
  assert.equal(banner!.minutes, 60);
  assert.equal(banner!.source, "guess");
  assert.equal(banner!.label, "Print");
  const [cards] = workForItem(item({ pricingMethod: "quantity_tier" }), [...machines, wide], ops);
  assert.equal(cards!.equipmentId, 1);
  // No wide-format printer: falls back to the digital press
  const [b2] = workForItem(item({ description: "Banner", pricingMethod: "per_sqft" }), machines, ops);
  assert.equal(b2!.equipmentId, 1);
});

test("installation, design and delivery lines aren't machine work", () => {
  assert.equal(isMachineWork({ description: "Installation (2 installers, lift)" }), false);
  assert.equal(isMachineWork({ description: "Delivery to site" }), false);
  assert.equal(isMachineWork({ description: "Logo", categoryName: "Graphic Design" }), false);
  assert.equal(isMachineWork({ description: "4' × 12' ACM building sign, UV laminate" }), true);
  assert.equal(workForItem(item({ description: "Installation" }), machines, ops).length, 0);
});

test("unscheduledWork: bookings on the same machine or the same kind of step count", () => {
  const pieces = workForItem(
    item({ pricingBreakdown: { production: { pressId: 1, runHours: 0.5 } }, pricingInput: { print: { operationIds: [2, 3] } } }),
    machines,
    ops,
  );
  assert.equal(pieces.length, 3); // press, cutter, folder
  const kinds = new Map(machines.map((m) => [m.id, m.kind]));
  assert.equal(unscheduledWork(pieces, [], kinds).length, 3);
  // Print moved to the offset press: still counts as printing booked.
  const left = unscheduledWork(pieces, [{ equipmentId: 2, jobItemId: 10 }], kinds);
  assert.deepEqual(left.map((p) => p.equipmentId), [3, 4]);
  // Another line's booking doesn't count.
  assert.equal(unscheduledWork(pieces, [{ equipmentId: 1, jobItemId: 11 }], kinds).length, 3);
  // One booking covers one piece only.
  assert.equal(unscheduledWork(pieces, [{ equipmentId: 3, jobItemId: 10 }], kinds).length, 2);
});

// ---------------------------------------------------------------------------
// Free time
// ---------------------------------------------------------------------------
test("freeIntervals", () => {
  const f = freeIntervals({ start: 0, end: 100 }, [
    { start: 10, end: 20 },
    { start: 15, end: 30 },
    { start: 90, end: 120 },
  ]);
  assert.deepEqual(f, [
    { start: 0, end: 10 },
    { start: 30, end: 90 },
  ]);
});

test("firstFreeSlot: fits between bookings within working hours", () => {
  const busy = [
    { start: at("2026-09-29", "08:00"), end: at("2026-09-29", "09:30") },
    { start: at("2026-09-29", "10:00"), end: at("2026-09-29", "12:00") },
  ];
  // 45 min doesn't fit in 9:30–10:00; next free is 12:00
  const s = firstFreeSlot(digital, busy, 45, at("2026-09-29", "07:00"), { tz: TZ })!;
  assert.equal(s.length, 1);
  assert.equal(hhmm(s[0]!.start), "2026-09-29 12:00");
  assert.equal(hhmm(s[0]!.end), "2026-09-29 12:45");
  // 30 min fits in the gap
  assert.equal(hhmm(firstFreeSlot(digital, busy, 30, at("2026-09-29", "07:00"), { tz: TZ })![0]!.start), "2026-09-29 09:30");
});

test("firstFreeSlot: not before 'earliest' (rounded up to 15 min), skips evenings and weekends", () => {
  const s = firstFreeSlot(digital, [], 60, at("2026-09-29", "10:07"), { tz: TZ })!;
  assert.equal(hhmm(s[0]!.start), "2026-09-29 10:15");
  // Friday 3:30 pm: an hour doesn't fit before 4 pm → Monday 8:00
  const f = firstFreeSlot(digital, [], 60, at("2026-10-02", "15:30"), { tz: TZ })!;
  assert.equal(hhmm(f[0]!.start), "2026-10-05 08:00");
  // Saturday machine
  const w = firstFreeSlot(wide, [], 60, at("2026-10-03", "07:00"), { tz: TZ })!;
  assert.equal(hhmm(w[0]!.start), "2026-10-03 08:00");
});

test("firstFreeSlot: work longer than a day is split over the next working days", () => {
  const s = firstFreeSlot(digital, [], 10 * 60, at("2026-10-01", "08:00"), { tz: TZ })!; // Thu
  assert.equal(s.length, 2);
  assert.equal(hhmm(s[0]!.start), "2026-10-01 08:00");
  assert.equal(hhmm(s[0]!.end), "2026-10-01 16:00");
  assert.equal(hhmm(s[1]!.start), "2026-10-02 08:00");
  assert.equal(hhmm(s[1]!.end), "2026-10-02 10:00");
});

test("firstFreeSlot across the fall-back weekend keeps 8:00 local", () => {
  const s = firstFreeSlot(digital, [], 60, at("2026-10-30", "16:00"), { tz: TZ })!; // Fri after hours
  assert.equal(hhmm(s[0]!.start), "2026-11-02 08:00");
  assert.equal(new Date(s[0]!.start).toISOString(), "2026-11-02T14:00:00.000Z"); // CST now
  assert.equal(s[0]!.end - s[0]!.start, 60 * MINUTE);
});

test("firstFreeSlot: a machine with no work days never fits", () => {
  assert.equal(firstFreeSlot({ hoursPerDay: 8, workDays: [] }, [], 30, at("2026-09-29", "08:00")), null);
  assert.equal(firstFreeSlot({ hoursPerDay: 0, workDays: [1] }, [], 30, at("2026-09-29", "08:00")), null);
});

// ---------------------------------------------------------------------------
// Auto-schedule
// ---------------------------------------------------------------------------
const waiting = (over: Partial<WaitingPiece>): WaitingPiece => ({
  key: "x",
  jobId: 1,
  jobItemId: 1,
  equipmentId: 1,
  stage: "press",
  minutes: 60,
  label: "Print",
  source: "estimate",
  detail: "",
  jobNumber: 1000,
  dueDate: null,
  priority: "normal",
  ...over,
});

test("scheduleOrder: due date first, then critical/rush, then job number; no due date last", () => {
  const list = [
    waiting({ key: "a", dueDate: "2026-10-05", jobNumber: 1 }),
    waiting({ key: "b", dueDate: null, priority: "critical", jobNumber: 2 }),
    waiting({ key: "c", dueDate: "2026-10-01", jobNumber: 3 }),
    waiting({ key: "d", dueDate: "2026-10-01", priority: "rush", jobNumber: 4 }),
  ];
  assert.deepEqual(scheduleOrder(list).map((p) => p.key), ["d", "c", "a", "b"]);
});

test("autoSchedule: fills machines in order and cutting waits for printing", () => {
  const now = at("2026-09-29", "08:00");
  const pieces = [
    waiting({ key: "1:press", jobItemId: 1, equipmentId: 1, minutes: 120, dueDate: "2026-10-02" }),
    waiting({ key: "1:m3", jobItemId: 1, equipmentId: 3, stage: "cutter", minutes: 15, dueDate: "2026-10-02" }),
    waiting({ key: "2:press", jobId: 2, jobItemId: 2, jobNumber: 1001, equipmentId: 1, minutes: 60, dueDate: "2026-09-30" }),
    waiting({ key: "3:guess", jobId: 3, jobItemId: 3, equipmentId: null, minutes: 60 }),
  ];
  const existing: BusyBlock[] = [{ id: 9, equipmentId: 1, start: at("2026-09-29", "08:00"), end: at("2026-09-29", "08:30") }];
  const { proposals, skipped } = autoSchedule(pieces, machines, existing, now, { tz: TZ });
  const by = new Map(proposals.map((p) => [p.piece.key, p]));
  // Due sooner goes first, after the existing booking
  assert.equal(hhmm(by.get("2:press")!.segments[0]!.start), "2026-09-29 08:30");
  assert.equal(hhmm(by.get("1:press")!.segments[0]!.start), "2026-09-29 09:30");
  assert.equal(hhmm(by.get("1:press")!.segments[0]!.end), "2026-09-29 11:30");
  // Cutter is free at 8:00 but must wait for the print to finish
  assert.equal(hhmm(by.get("1:m3")!.segments[0]!.start), "2026-09-29 11:30");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0]!.piece.key, "3:guess");
});

// ---------------------------------------------------------------------------
// Load & warnings
// ---------------------------------------------------------------------------
test("dayLoad counts only the part of a booking inside that day", () => {
  const blocks: BusyBlock[] = [
    { id: 1, equipmentId: 1, start: at("2026-09-29", "08:00"), end: at("2026-09-29", "11:00") },
    { id: 2, equipmentId: 1, start: at("2026-09-29", "22:00"), end: at("2026-09-30", "02:00") },
    { id: 3, equipmentId: 2, start: at("2026-09-29", "08:00"), end: at("2026-09-29", "16:00") },
  ];
  assert.deepEqual(dayLoad(digital, blocks, "2026-09-29", TZ), { booked: 5 * 60, capacity: 8 * 60 });
  assert.deepEqual(dayLoad(digital, blocks, "2026-10-03", TZ), { booked: 0, capacity: 0 }); // Saturday
});

test("blockIssues: double-booked, over capacity, outside hours, day off, late", () => {
  const blocks: BusyBlock[] = [
    { id: 1, equipmentId: 1, start: at("2026-09-29", "08:00"), end: at("2026-09-29", "14:00") },
    { id: 2, equipmentId: 1, start: at("2026-09-29", "13:00"), end: at("2026-09-29", "16:00") },
  ];
  const two = blockIssues({ ...blocks[1]!, dueDate: "2026-09-30" }, digital, blocks, TZ);
  assert.deepEqual(two.map((i) => i.kind).sort(), ["capacity", "overlap"]);
  assert.deepEqual(two.find((i) => i.kind === "overlap")!.withIds, [1]);
  assert.match(two.find((i) => i.kind === "capacity")!.text, /9 of 8 hr/);

  const evening = blockIssues({ equipmentId: 1, start: at("2026-09-30", "15:00"), end: at("2026-09-30", "17:00") }, digital, [], TZ);
  assert.deepEqual(evening.map((i) => i.kind), ["off_hours"]);

  const saturday = blockIssues({ equipmentId: 1, start: at("2026-10-03", "09:00"), end: at("2026-10-03", "10:00") }, digital, [], TZ);
  assert.deepEqual(saturday.map((i) => i.kind), ["day_off"]);
  assert.match(saturday[0]!.text, /Saturdays/);

  const late = blockIssues({ equipmentId: 1, start: at("2026-10-01", "09:00"), end: at("2026-10-01", "10:00"), dueDate: "2026-09-30" }, digital, [], TZ);
  assert.deepEqual(late.map((i) => i.kind), ["late"]);
  // Ending on the due date is fine
  assert.equal(blockIssues({ equipmentId: 1, start: at("2026-09-30", "09:00"), end: at("2026-09-30", "10:00"), dueDate: "2026-09-30" }, digital, [], TZ).length, 0);
  // Moving a block doesn't clash with itself
  assert.equal(blockIssues({ ...blocks[0]!, end: at("2026-09-29", "12:00") }, digital, [blocks[0]!], TZ).length, 0);
  // Touching end-to-start isn't an overlap
  assert.equal(blockIssues({ equipmentId: 1, start: at("2026-09-29", "14:00"), end: at("2026-09-29", "15:00") }, digital, [blocks[0]!], TZ).length, 0);
});

test("rangeLabel with the date, for history", () => {
  assert.equal(rangeLabel(at("2026-09-29", "09:00"), at("2026-09-29", "10:15"), TZ, { date: true }), "Tue, Sep 29, 9:00–10:15 am");
  assert.equal(rangeLabel(at("2026-10-30", "15:00"), at("2026-11-02", "09:00"), TZ, { date: true }), "Fri, Oct 30, 3:00 pm – Mon, Nov 2, 9:00 am");
});

test("unscheduledWork: a booking counts for its step (title) wherever it was moved", () => {
  const pieces = workForItem(
    item({ pricingBreakdown: { production: { pressId: 1, runHours: 0.5 } }, pricingInput: { print: { operationIds: [2] } } }),
    machines,
    ops,
  );
  const kinds = new Map(machines.map((m) => [m.id, m.kind]));
  // Print dragged onto the cutter, cutting still on the cutter: both booked.
  const left = unscheduledWork(
    pieces,
    [
      { equipmentId: 3, jobItemId: 10, title: "Print · 500 business cards" },
      { equipmentId: 3, jobItemId: 10, title: "Cutting, Round corners (part 1 of 2) · 500 business cards" },
    ],
    kinds,
  );
  // "Print" matches by its step; the renamed cutting booking still counts by its machine.
  assert.equal(left.length, 0);
  assert.equal(stepOfTitle("Cutting (part 2 of 3) · x"), "Cutting");
  const both = unscheduledWork(pieces, [{ equipmentId: 3, jobItemId: 10, title: "Print · x" }, { equipmentId: 3, jobItemId: 10, title: "Cutting · x" }], kinds);
  assert.equal(both.length, 0);
});
