import "server-only";
import { and, eq } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { jobs, scheduleBlocks, users } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { UserError } from "@/lib/actions";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notifications";
import { changeJobStatus } from "@/lib/jobs/service";
import { autoSchedule, blockIssues, firstFreeSlot, spanError, stageOf, stepOfTitle, type BlockStatus, type Span } from "./logic";
import { loadBlocks, loadBusy, loadMachines, loadWaiting } from "./queries";
import { HOUR, MINUTE, rangeLabel, snapNearest, ymdAt } from "./time";
import type { AutoPreview, BoardMachine, BoardPiece } from "./types";

export type { AutoPreview, AutoProposal } from "./types";

const MAX_TITLE = 200;
const lower = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
const when = (s: Span) => rangeLabel(s.start, s.end, undefined, { date: true });
const clip = (s: string, n = MAX_TITLE) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function machineOr404(tenantId: number, id: number, q: Tx | typeof db = db): Promise<BoardMachine> {
  const m = (await loadMachines(tenantId, q)).find((x) => x.id === id);
  if (!m) throw new UserError("Pick a machine from the list.");
  return m;
}

async function jobOr404(tx: Tx, tenantId: number, jobId: number) {
  const [job] = await tx.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId)));
  if (!job || job.archivedAt) throw new UserError("That job no longer exists.");
  return job;
}

/** Warnings for bookings just saved on one machine (for the toast). */
async function warningsFor(tenantId: number, machine: BoardMachine, spans: (Span & { id?: number })[], dueDate: string | null, q: Tx | typeof db = db): Promise<string[]> {
  if (!spans.length) return [];
  const from = Math.min(...spans.map((s) => s.start)) - 24 * HOUR;
  const to = Math.max(...spans.map((s) => s.end)) + 24 * HOUR;
  const all = (await loadBlocks(tenantId, from, to, q)).filter((b) => b.equipmentId === machine.id);
  const out = new Set<string>();
  for (const s of spans) for (const i of blockIssues({ ...s, equipmentId: machine.id, dueDate }, machine, all)) out.add(i.text);
  return [...out];
}

/** What a booking change says back: a line for the toast, its warnings, and where it starts (to jump there). */
export type BookResult = { summary: string; warnings: string[]; start?: number };

/**
 * Book one piece of a job's waiting work (see loadWaiting). With `start` it goes there (dragged onto
 * the board); without, into the first free time on the machine within working hours.
 */
export async function bookWork(
  user: SessionUser,
  input: { jobId: number; key: string; equipmentId?: number | null; start?: number | null; minutes?: number | null },
): Promise<BookResult> {
  const tenantId = user.tenantId;
  return db.transaction(async (tx) => {
    const job = await jobOr404(tx, tenantId, input.jobId);
    const machines = await loadMachines(tenantId, tx);
    const waiting = await loadWaiting(tenantId, { onlyJobId: job.id, machines }, tx);
    const piece = waiting[0]?.pieces.find((p) => p.key === input.key);
    if (!piece) throw new UserError("That work is already on the schedule.");
    const equipmentId = input.equipmentId ?? piece.equipmentId;
    if (!equipmentId) throw new UserError("Pick a machine for this work.");
    const machine = machines.find((m) => m.id === equipmentId);
    if (!machine) throw new UserError("Pick a machine from the list.");
    const minutes = Math.round(input.minutes ?? piece.minutes);
    if (!(minutes >= 15)) throw new UserError("The booking needs a length of at least 15 minutes.");

    let spans: Span[];
    if (input.start != null) {
      const start = snapNearest(input.start);
      spans = [{ start, end: start + minutes * MINUTE }];
    } else {
      const busy = await loadBusy(tenantId, [machine.id], Date.now(), tx);
      // Finishing waits for this line's printing.
      let earliest = Date.now();
      if (stageOf(machine.kind) !== "press" && piece.jobItemId) {
        const all = await loadBusy(tenantId, machines.filter((m) => stageOf(m.kind) === "press").map((m) => m.id), 0, tx);
        for (const b of all) if (b.jobItemId === piece.jobItemId) earliest = Math.max(earliest, b.end);
      }
      const found = firstFreeSlot(machine, busy, minutes, earliest);
      if (!found) throw new UserError(`${machine.name} has no free time in the next 60 days that fits ${Math.round(minutes)} minutes. Drag it onto the board instead.`);
      spans = found;
    }
    for (const s of spans) {
      const err = spanError(s.start, s.end);
      if (err) throw new UserError(err);
    }
    const saved = await insertPiece(tx, user, piece, machine, spans);
    const summary = `Scheduled ${lower(piece.label)} on ${machine.name} ${spans.map((s) => rangeLabel(s.start, s.end)).join(", ")}`;
    await logActivity(
      {
        tenantId,
        action: "job.scheduled",
        entityType: "job",
        entityId: job.id,
        jobId: job.id,
        actorId: user.id,
        summary: `Scheduled ${lower(piece.label)} on ${machine.name} ${spans.map(when).join(" and ")}`,
        data: { equipmentId: machine.id, jobItemId: piece.jobItemId, spans: spans.map((s) => ({ startsAt: new Date(s.start).toISOString(), endsAt: new Date(s.end).toISOString() })) },
      },
      tx,
    );
    return { summary, warnings: await warningsFor(tenantId, machine, saved, job.dueDate, tx), start: spans[0]!.start };
  });
}

/** Insert the bookings for one piece of work; returns them with their ids. */
async function insertPiece(tx: Tx, user: SessionUser, piece: BoardPiece, machine: BoardMachine, spans: Span[]): Promise<(Span & { id: number })[]> {
  const title = clip(`${piece.label} · ${piece.itemDescription}`);
  const rows = await tx.insert(scheduleBlocks).values(
    spans.map((s, i) => ({
      tenantId: user.tenantId,
      equipmentId: machine.id,
      jobId: piece.jobId,
      jobItemId: piece.jobItemId,
      title: spans.length > 1 ? clip(`${piece.label} (part ${i + 1} of ${spans.length}) · ${piece.itemDescription}`) : title,
      startsAt: new Date(s.start),
      endsAt: new Date(s.end),
      createdBy: user.id,
    })),
  ).returning({ id: scheduleBlocks.id });
  return spans.map((s, i) => ({ ...s, id: rows[i]!.id }));
}

async function blockOr404(tx: Tx, tenantId: number, id: number) {
  const [b] = await tx.select().from(scheduleBlocks).where(and(eq(scheduleBlocks.tenantId, tenantId), eq(scheduleBlocks.id, id)));
  if (!b) throw new UserError("That booking is no longer on the schedule.");
  return b;
}

/** "print", "cutting" — the step, from the booking's title. */
const stepOf = (title: string) => lower(stepOfTitle(title));

/** Move a booking to another machine and/or time (drag and drop). Keeps its length unless `end` is given. */
export async function moveBlock(user: SessionUser, id: number, to: { equipmentId: number; start: number; end?: number | null }): Promise<BookResult> {
  const tenantId = user.tenantId;
  return db.transaction(async (tx) => {
    const b = await blockOr404(tx, tenantId, id);
    const machine = await machineOr404(tenantId, to.equipmentId, tx);
    const start = snapNearest(to.start);
    const end = to.end != null ? snapNearest(to.end) : start + (b.endsAt.getTime() - b.startsAt.getTime());
    const err = spanError(start, end);
    if (err) throw new UserError(err);
    if (b.equipmentId === machine.id && b.startsAt.getTime() === start && b.endsAt.getTime() === end) return { summary: "No change", warnings: [] };
    await tx
      .update(scheduleBlocks)
      .set({ equipmentId: machine.id, startsAt: new Date(start), endsAt: new Date(end), updatedAt: new Date() })
      .where(and(eq(scheduleBlocks.tenantId, tenantId), eq(scheduleBlocks.id, id)));
    const oldMachine = (await loadMachines(tenantId, tx, { includeInactive: true })).find((m) => m.id === b.equipmentId);
    const summary = `${b.equipmentId === machine.id ? "Moved" : `Moved to ${machine.name},`} ${rangeLabel(start, end)}`;
    let dueDate: string | null = null;
    if (b.jobId) {
      const job = await jobOr404(tx, tenantId, b.jobId);
      dueDate = job.dueDate;
      await logActivity(
        {
          tenantId,
          action: "job.scheduled",
          entityType: "job",
          entityId: job.id,
          jobId: job.id,
          actorId: user.id,
          summary: `Rescheduled ${stepOf(b.title)} to ${machine.name} ${when({ start, end })} (was ${oldMachine?.name ?? "another machine"} ${when({ start: b.startsAt.getTime(), end: b.endsAt.getTime() })})`,
          data: {
            before: { equipmentId: b.equipmentId, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString() },
            after: { equipmentId: machine.id, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() },
          },
        },
        tx,
      );
    }
    return { summary, warnings: await warningsFor(tenantId, machine, [{ id, start, end }], dueDate, tx), start };
  });
}

export type BlockInput = {
  id: number | null;
  equipmentId: number;
  start: number;
  end: number;
  operatorId: number | null;
  notes: string | null;
  /** Required for time blocked off without a job ("Maintenance"). */
  title: string | null;
};

/** Save the edit dialog: machine, start, length, operator, notes. Without an id, blocks off machine time (maintenance). */
export async function saveBlock(user: SessionUser, v: BlockInput): Promise<BookResult & { id: number }> {
  const tenantId = user.tenantId;
  const err = spanError(v.start, v.end);
  if (err) throw new UserError(err);
  const start = snapNearest(v.start);
  const end = snapNearest(v.end);
  if (end <= start) throw new UserError("The booking needs a length of at least 15 minutes.");
  return db.transaction(async (tx) => {
    const machine = await machineOr404(tenantId, v.equipmentId, tx);
    if (v.operatorId) {
      const [op] = await tx.select({ id: users.id, active: users.active }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, v.operatorId)));
      if (!op || !op.active) throw new UserError("Pick an operator from the list.");
    }
    const notes = v.notes?.trim() ? clip(v.notes.trim(), 2000) : null;
    if (v.id == null) {
      const title = v.title?.trim();
      if (!title) throw new UserError("Say what the time is for, like “Maintenance” or “Service visit”.");
      const [row] = await tx
        .insert(scheduleBlocks)
        .values({ tenantId, equipmentId: machine.id, title: clip(title), startsAt: new Date(start), endsAt: new Date(end), operatorId: v.operatorId, notes, createdBy: user.id })
        .returning({ id: scheduleBlocks.id });
      await logActivity(
        {
          tenantId,
          action: "schedule.blocked",
          entityType: "setting",
          entityId: row!.id,
          actorId: user.id,
          summary: `Blocked off ${machine.name} ${when({ start, end })}: ${clip(title, 80)}`,
          data: { key: "schedule", equipmentId: machine.id },
        },
        tx,
      );
      if (v.operatorId)
        await notify({ tenantId, userIds: [v.operatorId], kind: "assigned", title: `You're on ${machine.name} ${rangeLabel(start, end)}: ${clip(title, 60)}`, link: `/schedule?date=${ymdAt(start)}&view=day`, actorId: user.id }, tx);
      return { id: row!.id, summary: `Blocked off ${machine.name} ${rangeLabel(start, end)}`, warnings: await warningsFor(tenantId, machine, [{ id: row!.id, start, end }], null, tx) };
    }

    const b = await blockOr404(tx, tenantId, v.id);
    const title = b.jobId ? b.title : v.title?.trim() ? clip(v.title.trim()) : b.title;
    const before = { equipmentId: b.equipmentId, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), operatorId: b.operatorId, notes: b.notes, title: b.title };
    const after = { equipmentId: machine.id, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), operatorId: v.operatorId, notes, title };
    const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]);
    if (changed.length) {
      await tx
        .update(scheduleBlocks)
        .set({ equipmentId: machine.id, startsAt: new Date(start), endsAt: new Date(end), operatorId: v.operatorId, notes, title, updatedAt: new Date() })
        .where(and(eq(scheduleBlocks.tenantId, tenantId), eq(scheduleBlocks.id, b.id)));
      const parts: string[] = [];
      if (changed.includes("equipmentId") || changed.includes("startsAt") || changed.includes("endsAt")) parts.push(`${machine.name} ${when({ start, end })}`);
      if (changed.includes("operatorId")) {
        const [op] = v.operatorId ? await tx.select({ name: users.name }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, v.operatorId))) : [];
        parts.push(op ? `operator ${op.name}` : "no operator");
      }
      if (changed.includes("notes")) parts.push("notes");
      if (changed.includes("title")) parts.push(`“${clip(title, 60)}”`);
      const pick = (o: Record<string, unknown>) => Object.fromEntries(changed.map((k) => [k, o[k]]));
      await logActivity(
        {
          tenantId,
          action: b.jobId ? "job.scheduled" : "schedule.blocked",
          entityType: b.jobId ? "job" : "setting",
          entityId: b.jobId ?? b.id,
          jobId: b.jobId,
          actorId: user.id,
          summary: `Updated ${b.jobId ? stepOf(b.title) : "blocked time"} booking: ${parts.join(", ")}`,
          data: { ...(b.jobId ? {} : { key: "schedule" }), before: pick(before), after: pick(after) },
        },
        tx,
      );
      if (changed.includes("operatorId") && v.operatorId) {
        const [job] = b.jobId ? await tx.select({ number: jobs.number, title: jobs.title }).from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, b.jobId))) : [];
        await notify(
          {
            tenantId,
            userIds: [v.operatorId],
            kind: "assigned",
            title: `You're on ${machine.name} ${rangeLabel(start, end)}${job ? `: ${job.title}` : ""}`,
            body: clip(title, 120),
            link: b.jobId ? `/schedule?job=${b.jobId}&date=${ymdAt(start)}&view=day` : `/schedule?date=${ymdAt(start)}&view=day`,
            actorId: user.id,
          },
          tx,
        );
      }
    }
    let dueDate: string | null = null;
    if (b.jobId) dueDate = (await jobOr404(tx, tenantId, b.jobId)).dueDate;
    return { id: b.id, summary: "Saved", warnings: await warningsFor(tenantId, machine, [{ id: b.id, start, end }], dueDate, tx) };
  });
}

const STATUS_VERB: Record<BlockStatus, string> = { scheduled: "Put back to scheduled", running: "Started", done: "Finished" };

/**
 * Start / finish a booking (production can do this). Starting the first booking of a job that's
 * approved for production moves the job to Production.
 */
export async function setBlockStatus(user: SessionUser, id: number, status: BlockStatus): Promise<{ summary: string }> {
  const tenantId = user.tenantId;
  return db.transaction(async (tx) => {
    const b = await blockOr404(tx, tenantId, id);
    if (b.status === status) return { summary: STATUS_VERB[status] };
    await tx.update(scheduleBlocks).set({ status, updatedAt: new Date() }).where(and(eq(scheduleBlocks.tenantId, tenantId), eq(scheduleBlocks.id, id)));
    const machine = (await loadMachines(tenantId, tx, { includeInactive: true })).find((m) => m.id === b.equipmentId);
    let summary = `${STATUS_VERB[status]} ${b.jobId ? stepOf(b.title) : lower(b.title)} on ${machine?.name ?? "the machine"}`;
    if (b.jobId) {
      const job = await jobOr404(tx, tenantId, b.jobId);
      await logActivity(
        {
          tenantId,
          action: "job.schedule_status",
          entityType: "job",
          entityId: job.id,
          jobId: job.id,
          actorId: user.id,
          summary,
          data: { blockId: b.id, before: { status: b.status }, after: { status } },
        },
        tx,
      );
      if (status === "running" && job.status === "approved_for_production" && can(user.role, "jobs.status")) {
        await changeJobStatus(tx, job, "production", { id: user.id, name: user.name, tenantId }, { reason: `started on ${machine?.name ?? "a machine"}` });
        summary += " · job moved to Production";
      }
    }
    return { summary };
  });
}

/** Take a booking off the schedule. Its work goes back to "Waiting to be scheduled"; history keeps the record. */
export async function removeBlock(user: SessionUser, id: number): Promise<{ summary: string }> {
  const tenantId = user.tenantId;
  return db.transaction(async (tx) => {
    const b = await blockOr404(tx, tenantId, id);
    const machine = (await loadMachines(tenantId, tx, { includeInactive: true })).find((m) => m.id === b.equipmentId);
    // A booking is a plan, not a business record: it's removed, and the job's history says so.
    await tx.delete(scheduleBlocks).where(and(eq(scheduleBlocks.tenantId, tenantId), eq(scheduleBlocks.id, id)));
    const span = { start: b.startsAt.getTime(), end: b.endsAt.getTime() };
    const what = b.jobId ? stepOf(b.title) : lower(b.title);
    await logActivity(
      {
        tenantId,
        action: b.jobId ? "job.unscheduled" : "schedule.unblocked",
        entityType: b.jobId ? "job" : "setting",
        entityId: b.jobId ?? b.id,
        jobId: b.jobId,
        actorId: user.id,
        summary: `Took ${what} off the schedule (was ${machine?.name ?? "a machine"} ${when(span)})`,
        data: { ...(b.jobId ? {} : { key: "schedule" }), before: { equipmentId: b.equipmentId, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), status: b.status, title: b.title }, after: null },
      },
      tx,
    );
    return { summary: `Took ${what} off the schedule` };
  });
}

// ---------------------------------------------------------------------------
// Auto-schedule all waiting
// ---------------------------------------------------------------------------
/** Where every waiting piece would go (nothing saved). */
export async function previewAutoSchedule(user: SessionUser): Promise<AutoPreview> {
  const tenantId = user.tenantId;
  const machines = await loadMachines(tenantId);
  const waiting = await loadWaiting(tenantId, { machines });
  const now = Date.now();
  const busy = await loadBusy(tenantId, machines.map((m) => m.id), now);
  const jobsById = new Map(waiting.map((j) => [j.id, j]));
  const { proposals, skipped } = autoSchedule(
    waiting.flatMap((j) => j.pieces),
    machines,
    busy,
    now,
  );
  const names = new Map(machines.map((m) => [m.id, m.name]));
  return {
    proposals: proposals.map((p) => {
      const j = jobsById.get(p.piece.jobId)!;
      const end = p.segments[p.segments.length - 1]!.end;
      return {
        jobId: j.id,
        jobNumber: j.number,
        jobTitle: j.title,
        customer: j.customer,
        dueDate: j.dueDate,
        priority: j.priority,
        key: p.piece.key,
        label: p.piece.label,
        itemDescription: p.piece.itemDescription,
        equipmentId: p.equipmentId,
        machineName: names.get(p.equipmentId) ?? "Machine",
        minutes: p.piece.minutes,
        segments: p.segments,
        late: !!j.dueDate && ymdAt(end - 1) > j.dueDate,
      };
    }),
    skipped: skipped.map((s) => {
      const j = jobsById.get(s.piece.jobId)!;
      return { jobNumber: j.number, jobTitle: j.title, label: s.piece.label, reason: s.reason };
    }),
  };
}

/** Save the previewed bookings. Work someone booked in the meantime is skipped. */
export async function commitAutoSchedule(user: SessionUser, picks: { jobId: number; key: string; equipmentId: number; segments: Span[] }[]): Promise<{ booked: number; skipped: number }> {
  const tenantId = user.tenantId;
  if (!picks.length) throw new UserError("Nothing to schedule.");
  if (picks.length > 500) throw new UserError("Too many bookings at once.");
  return db.transaction(async (tx) => {
    const machines = await loadMachines(tenantId, tx);
    const byId = new Map(machines.map((m) => [m.id, m]));
    const jobIds = [...new Set(picks.map((p) => p.jobId))];
    const waiting = new Map<number, BoardPiece[]>();
    for (const w of await loadWaiting(tenantId, { machines }, tx)) waiting.set(w.id, w.pieces);
    // Jobs outside the usual steps (opened from their page) are looked up one by one.
    for (const id of jobIds.filter((i) => !waiting.has(i))) {
      const w = await loadWaiting(tenantId, { onlyJobId: id, machines }, tx);
      if (w[0]) waiting.set(id, w[0].pieces);
    }
    let booked = 0;
    let skipped = 0;
    const perJob = new Map<number, string[]>();
    for (const p of picks) {
      const piece = waiting.get(p.jobId)?.find((x) => x.key === p.key);
      const machine = byId.get(p.equipmentId);
      const spans = p.segments.map((s) => ({ start: snapNearest(s.start), end: snapNearest(s.end) }));
      if (!piece || !machine || !spans.length || spans.some((s) => spanError(s.start, s.end))) {
        skipped++;
        continue;
      }
      await insertPiece(tx, user, piece, machine, spans);
      // Don't book the same piece twice if it's in the list twice.
      waiting.set(p.jobId, waiting.get(p.jobId)!.filter((x) => x !== piece));
      perJob.set(p.jobId, [...(perJob.get(p.jobId) ?? []), `${lower(piece.label)} on ${machine.name} ${spans.map(when).join(" and ")}`]);
      booked++;
    }
    for (const [jobId, parts] of perJob)
      await logActivity({ tenantId, action: "job.scheduled", entityType: "job", entityId: jobId, jobId, actorId: user.id, summary: `Auto-scheduled ${parts.join("; ")}` }, tx);
    return { booked, skipped };
  });
}
