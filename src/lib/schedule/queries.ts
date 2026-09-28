import "server-only";
import { and, asc, eq, gt, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { customers, equipment, jobItems, jobs, operations, productCategories, scheduleBlocks, users, type JobStatus } from "@/lib/db/schema";
import { addDays } from "@/lib/format";
import { blockIssues, dayLoad, unscheduledWork, workForItem, type MachineKind, type OpInfo, type SchedMachine } from "./logic";
import { dayBounds, ymdAt } from "./time";
import type { BoardBlock, BoardMachine, BoardPiece, WaitingJob } from "./types";

type Q = Tx | typeof db;

/** Jobs whose machine work shows in "Waiting to be scheduled". */
export const SCHEDULABLE_STATUSES: JobStatus[] = ["approved_for_production", "production"];
/** A job opened from its page (?job=) shows its work unless it's finished. */
const CLOSED_STATUSES: JobStatus[] = ["completed", "cancelled"];

/** The shop's machines that run (active), board order: presses first, then bindery. */
export async function loadMachines(tenantId: number, q: Q = db, opts: { includeInactive?: boolean } = {}): Promise<(BoardMachine & { active: boolean })[]> {
  const rows = await q
    .select({
      id: equipment.id,
      name: equipment.name,
      kind: equipment.kind,
      hoursPerDay: equipment.hoursPerDay,
      workDays: equipment.workDays,
      setupMinutes: equipment.setupMinutes,
      sortOrder: equipment.sortOrder,
      active: equipment.active,
    })
    .from(equipment)
    .where(opts.includeInactive ? eq(equipment.tenantId, tenantId) : and(eq(equipment.tenantId, tenantId), eq(equipment.active, true)))
    .orderBy(asc(equipment.sortOrder), asc(equipment.name));
  const rank: Record<MachineKind, number> = { digital: 0, offset: 1, wide_format: 2, cutter: 3, folder: 4, bindery: 5, other: 6 };
  return rows
    .map((r) => ({ ...r, hoursPerDay: Number(r.hoursPerDay), workDays: Array.isArray(r.workDays) ? r.workDays : [1, 2, 3, 4, 5] }))
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

const blockColumns = {
  id: scheduleBlocks.id,
  equipmentId: scheduleBlocks.equipmentId,
  startsAt: scheduleBlocks.startsAt,
  endsAt: scheduleBlocks.endsAt,
  status: scheduleBlocks.status,
  title: scheduleBlocks.title,
  notes: scheduleBlocks.notes,
  operatorId: scheduleBlocks.operatorId,
  operatorName: users.name,
  jobItemId: scheduleBlocks.jobItemId,
  quantity: jobItems.quantity,
  jobId: jobs.id,
  jobNumber: jobs.number,
  jobTitle: jobs.title,
  dueDate: jobs.dueDate,
  priority: jobs.priority,
  jobStatus: jobs.status,
  customer: customers.name,
};

/** Bookings with their job, customer, line and operator. */
function selectBlocks(q: Q, tenantId: number, cond: SQL | undefined) {
  return q
    .select(blockColumns)
    .from(scheduleBlocks)
    .leftJoin(jobs, and(eq(jobs.tenantId, scheduleBlocks.tenantId), eq(jobs.id, scheduleBlocks.jobId)))
    .leftJoin(customers, and(eq(customers.tenantId, jobs.tenantId), eq(customers.id, jobs.customerId)))
    .leftJoin(jobItems, and(eq(jobItems.tenantId, scheduleBlocks.tenantId), eq(jobItems.id, scheduleBlocks.jobItemId)))
    .leftJoin(users, and(eq(users.tenantId, scheduleBlocks.tenantId), eq(users.id, scheduleBlocks.operatorId)))
    .where(and(eq(scheduleBlocks.tenantId, tenantId), cond))
    .orderBy(asc(scheduleBlocks.startsAt), asc(scheduleBlocks.id));
}

type BlockRow = Awaited<ReturnType<typeof selectBlocks>>[number];
function toBoardBlock(r: BlockRow): BoardBlock {
  return {
    id: r.id,
    equipmentId: r.equipmentId,
    start: r.startsAt.getTime(),
    end: r.endsAt.getTime(),
    status: r.status,
    title: r.title,
    notes: r.notes,
    operatorId: r.operatorId,
    operatorName: r.operatorName,
    jobItemId: r.jobItemId,
    quantity: r.quantity,
    job:
      r.jobId != null
        ? { id: r.jobId, number: r.jobNumber!, title: r.jobTitle!, customer: r.customer ?? "", dueDate: r.dueDate, priority: r.priority!, status: r.jobStatus! }
        : null,
  };
}

/** Bookings that overlap [from, to). */
export async function loadBlocks(tenantId: number, from: number, to: number, q: Q = db): Promise<BoardBlock[]> {
  const rows = await selectBlocks(q, tenantId, and(lt(scheduleBlocks.startsAt, new Date(to)), gt(scheduleBlocks.endsAt, new Date(from))));
  return rows.map(toBoardBlock);
}

/** One booking (scoped to the shop), or null. */
export async function loadBlock(tenantId: number, id: number, q: Q = db): Promise<BoardBlock | null> {
  const rows = await selectBlocks(q, tenantId, eq(scheduleBlocks.id, id));
  return rows[0] ? toBoardBlock(rows[0]) : null;
}

/** Every booking for these jobs (any date). */
export async function loadJobBlocks(tenantId: number, jobIds: number[], q: Q = db): Promise<BoardBlock[]> {
  if (!jobIds.length) return [];
  const rows = await selectBlocks(q, tenantId, inArray(scheduleBlocks.jobId, jobIds));
  return rows.map(toBoardBlock);
}

/** Bookings on these machines from `from` on (for finding free time). */
export async function loadBusy(tenantId: number, equipmentIds: number[], from: number, q: Q = db) {
  if (!equipmentIds.length) return [];
  const rows = await q
    .select({ id: scheduleBlocks.id, equipmentId: scheduleBlocks.equipmentId, jobItemId: scheduleBlocks.jobItemId, startsAt: scheduleBlocks.startsAt, endsAt: scheduleBlocks.endsAt })
    .from(scheduleBlocks)
    .where(and(eq(scheduleBlocks.tenantId, tenantId), inArray(scheduleBlocks.equipmentId, equipmentIds), gt(scheduleBlocks.endsAt, new Date(from))));
  return rows.map((r) => ({ id: r.id, equipmentId: r.equipmentId, jobItemId: r.jobItemId, start: r.startsAt.getTime(), end: r.endsAt.getTime() }));
}

async function loadOps(tenantId: number, q: Q): Promise<OpInfo[]> {
  return q
    .select({ id: operations.id, name: operations.name, basis: operations.basis, piecesPerHour: operations.piecesPerHour, equipmentId: operations.equipmentId })
    .from(operations)
    .where(eq(operations.tenantId, tenantId))
    .orderBy(asc(operations.sortOrder), asc(operations.name));
}

/**
 * Machine work not booked yet, grouped by job. Jobs approved for production or in production, plus
 * `alsoJobId` (the job opened from its page) whatever its step, unless it's finished.
 */
export async function loadWaiting(tenantId: number, opts: { alsoJobId?: number | null; onlyJobId?: number | null; machines?: SchedMachine[] } = {}, q: Q = db): Promise<WaitingJob[]> {
  const machines = opts.machines ?? (await loadMachines(tenantId, q));
  const statusCond = opts.onlyJobId
    ? eq(jobs.id, opts.onlyJobId)
    : opts.alsoJobId
      ? or(inArray(jobs.status, SCHEDULABLE_STATUSES), eq(jobs.id, opts.alsoJobId))
      : inArray(jobs.status, SCHEDULABLE_STATUSES);
  const jobRows = await q
    .select({
      id: jobs.id,
      number: jobs.number,
      title: jobs.title,
      customer: customers.name,
      dueDate: jobs.dueDate,
      priority: jobs.priority,
      status: jobs.status,
    })
    .from(jobs)
    .innerJoin(customers, and(eq(customers.tenantId, jobs.tenantId), eq(customers.id, jobs.customerId)))
    .where(and(eq(jobs.tenantId, tenantId), isNull(jobs.archivedAt), statusCond))
    .orderBy(asc(jobs.dueDate), asc(jobs.number));
  const open = jobRows.filter((j) => !CLOSED_STATUSES.includes(j.status));
  if (!open.length || !machines.length) return [];
  const ids = open.map((j) => j.id);
  const [items, ops, booked] = await Promise.all([
    q
      .select({
        id: jobItems.id,
        jobId: jobItems.jobId,
        quantity: jobItems.quantity,
        description: jobItems.description,
        pricingInput: jobItems.pricingInput,
        pricingBreakdown: jobItems.pricingBreakdown,
        categoryName: productCategories.name,
        categoryGroup: productCategories.group,
        pricingMethod: productCategories.pricingMethod,
      })
      .from(jobItems)
      .leftJoin(productCategories, and(eq(productCategories.tenantId, jobItems.tenantId), eq(productCategories.id, jobItems.categoryId)))
      .where(and(eq(jobItems.tenantId, tenantId), inArray(jobItems.jobId, ids)))
      .orderBy(asc(jobItems.sortOrder), asc(jobItems.id)),
    loadOps(tenantId, q),
    q
      .select({ equipmentId: scheduleBlocks.equipmentId, jobItemId: scheduleBlocks.jobItemId, title: scheduleBlocks.title })
      .from(scheduleBlocks)
      .where(and(eq(scheduleBlocks.tenantId, tenantId), inArray(scheduleBlocks.jobId, ids))),
  ]);
  // Bookings on machines that were turned off still count as booked.
  const allMachines = await loadMachines(tenantId, q, { includeInactive: true });
  const kinds = new Map(allMachines.map((m) => [m.id, m.kind]));
  const out: WaitingJob[] = [];
  for (const j of open) {
    const pieces: BoardPiece[] = [];
    for (const it of items.filter((i) => i.jobId === j.id)) {
      const work = workForItem(it, machines, ops);
      for (const p of unscheduledWork(work, booked, kinds))
        pieces.push({ ...p, jobNumber: j.number, dueDate: j.dueDate, priority: j.priority, itemDescription: it.description, quantity: it.quantity });
    }
    if (pieces.length) out.push({ ...j, pieces });
  }
  return out;
}

// ---------------------------------------------------------------------------
// For other pages
// ---------------------------------------------------------------------------

/** This job's bookings and the machine work still waiting (for the job page card). */
export async function getJobSchedule(tenantId: number, jobId: number) {
  const machines = await loadMachines(tenantId);
  const [blocks, waiting] = await Promise.all([loadJobBlocks(tenantId, [jobId]), loadWaiting(tenantId, { onlyJobId: jobId, machines })]);
  const names = new Map((await loadMachines(tenantId, db, { includeInactive: true })).map((m) => [m.id, m.name]));
  const [job] = await db.select({ status: jobs.status }).from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId)));
  return {
    status: job?.status ?? null,
    blocks: blocks.map((b) => ({ ...b, machineName: names.get(b.equipmentId) ?? "Machine" })),
    waiting: waiting[0]?.pieces.map((p) => ({ ...p, machineName: p.equipmentId ? (names.get(p.equipmentId) ?? null) : null })) ?? [],
  };
}

export type ScheduleSummary = {
  date: string;
  machines: { id: number; name: string; kind: MachineKind; bookedMinutes: number; capacityMinutes: number; running: number; overbooked: boolean; doubleBooked: boolean }[];
  /** Machines with more booked than they can run that day (or double-booked). */
  overbooked: { id: number; name: string; bookedMinutes: number; capacityMinutes: number }[];
  /** Bookings that end after their job is due. */
  late: { blockId: number; jobId: number; jobNumber: number; jobTitle: string; machineName: string; start: number; end: number; dueDate: string }[];
  totalBookedMinutes: number;
  /** Jobs with machine work not booked yet. */
  waitingJobs: number;
};

/** Today's machine load for the dashboard: booked hours per machine, overbooked machines, bookings late for their due date. */
export async function getScheduleSummary(tenantId: number, date: string): Promise<ScheduleSummary> {
  const machines = await loadMachines(tenantId);
  const day = dayBounds(date);
  // Late bookings: from today on, a week ahead.
  const [blocks, ahead, waiting] = await Promise.all([
    loadBlocks(tenantId, day.start, day.end),
    loadBlocks(tenantId, day.start, dayBounds(addDays(date, 7)).end),
    loadWaiting(tenantId, { machines }),
  ]);
  const busy = blocks.map((b) => ({ ...b }));
  const rows = machines.map((m) => {
    const load = dayLoad(m, busy, date);
    const mine = busy.filter((b) => b.equipmentId === m.id);
    const doubleBooked = mine.some((b) => mine.some((o) => o.id !== b.id && o.start < b.end && o.end > b.start));
    return {
      id: m.id,
      name: m.name,
      kind: m.kind,
      bookedMinutes: load.booked,
      capacityMinutes: load.capacity,
      running: mine.filter((b) => b.status === "running").length,
      overbooked: load.booked > load.capacity || doubleBooked,
      doubleBooked,
    };
  });
  const names = new Map(machines.map((m) => [m.id, m.name]));
  const late = ahead
    .filter((b) => b.status !== "done" && b.job?.dueDate && ymdAt(b.end - 1) > b.job.dueDate)
    .map((b) => ({ blockId: b.id, jobId: b.job!.id, jobNumber: b.job!.number, jobTitle: b.job!.title, machineName: names.get(b.equipmentId) ?? "Machine", start: b.start, end: b.end, dueDate: b.job!.dueDate! }));
  return {
    date,
    machines: rows,
    overbooked: rows.filter((r) => r.overbooked).map((r) => ({ id: r.id, name: r.name, bookedMinutes: r.bookedMinutes, capacityMinutes: r.capacityMinutes })),
    late,
    totalBookedMinutes: rows.reduce((s, r) => s + r.bookedMinutes, 0),
    waitingJobs: waiting.length,
  };
}

/** Warnings for one saved booking (used in activity text and the job card). */
export function issuesFor(b: BoardBlock, machine: SchedMachine | undefined, all: BoardBlock[]) {
  return blockIssues({ ...b, dueDate: b.job?.dueDate ?? null }, machine, all);
}
