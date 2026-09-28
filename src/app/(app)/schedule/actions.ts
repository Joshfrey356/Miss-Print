"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { bookWork, commitAutoSchedule, moveBlock, previewAutoSchedule, removeBlock, saveBlock, setBlockStatus, type BookResult } from "@/lib/schedule/service";
import type { AutoPreview } from "@/lib/schedule/types";

const id = z.number().int().positive();
const ms = z.number();

/** The board, and the pages that show bookings (dashboard, TV, job page card). */
function refresh() {
  revalidatePath("/schedule");
  revalidatePath("/dashboard");
  revalidatePath("/tv");
  revalidatePath("/jobs/[number]", "page");
}

/** Book waiting work: into the first free time, or at `start` when dropped on the board. */
export async function scheduleWork(input: { jobId: number; key: string; equipmentId?: number | null; start?: number | null; minutes?: number | null }): Promise<ActionResult<BookResult>> {
  return runAction(async () => {
    const user = await requirePermission("schedule.edit");
    const v = z
      .object({ jobId: id, key: z.string().min(1).max(40), equipmentId: id.nullish(), start: ms.nullish(), minutes: z.number().min(15).max(14 * 24 * 60).nullish() })
      .parse(input);
    const r = await bookWork(user, v);
    refresh();
    return r;
  });
}

/** Drag a booking to another time or machine, or resize it. */
export async function moveScheduleBlock(input: { id: number; equipmentId: number; start: number; end?: number | null }): Promise<ActionResult<BookResult>> {
  return runAction(async () => {
    const user = await requirePermission("schedule.edit");
    const v = z.object({ id, equipmentId: id, start: ms, end: ms.nullish() }).parse(input);
    const r = await moveBlock(user, v.id, v);
    refresh();
    return r;
  });
}

/** The edit dialog (and "Block off time" for maintenance). Times come from the browser as instants. */
export async function saveScheduleBlock(input: {
  id?: number | null;
  equipmentId: number;
  start: number;
  end: number;
  operatorId?: number | null;
  notes?: string | null;
  title?: string | null;
}): Promise<ActionResult<BookResult & { id: number }>> {
  return runAction(async () => {
    const user = await requirePermission("schedule.edit");
    const v = z
      .object({
        id: id.nullish(),
        equipmentId: id,
        start: ms,
        end: ms,
        operatorId: id.nullish(),
        notes: z.string().max(4000).nullish(),
        title: z.string().max(400).nullish(),
      })
      .parse(input);
    const r = await saveBlock(user, { id: v.id ?? null, equipmentId: v.equipmentId, start: v.start, end: v.end, operatorId: v.operatorId ?? null, notes: v.notes ?? null, title: v.title ?? null });
    refresh();
    return r;
  });
}

export async function setScheduleBlockStatus(blockId: number, status: "scheduled" | "running" | "done"): Promise<ActionResult<{ summary: string }>> {
  return runAction(async () => {
    const user = await requirePermission("schedule.edit");
    const v = z.object({ id, status: z.enum(["scheduled", "running", "done"]) }).parse({ id: blockId, status });
    const r = await setBlockStatus(user, v.id, v.status);
    refresh();
    return r;
  });
}

export async function unscheduleBlock(blockId: number): Promise<ActionResult<{ summary: string }>> {
  return runAction(async () => {
    const user = await requirePermission("schedule.edit");
    const r = await removeBlock(user, id.parse(blockId));
    refresh();
    return r;
  });
}

/** Where "Auto-schedule all waiting" would put everything. Nothing is saved. */
export async function previewAutoScheduleAction(): Promise<ActionResult<AutoPreview>> {
  return runAction(async () => {
    const user = await requirePermission("schedule.edit");
    return previewAutoSchedule(user);
  });
}

export async function commitAutoScheduleAction(picks: { jobId: number; key: string; equipmentId: number; segments: { start: number; end: number }[] }[]): Promise<ActionResult<{ booked: number; skipped: number }>> {
  return runAction(async () => {
    const user = await requirePermission("schedule.edit");
    const v = z
      .array(z.object({ jobId: id, key: z.string().min(1).max(40), equipmentId: id, segments: z.array(z.object({ start: ms, end: ms })).min(1).max(60) }))
      .max(500)
      .parse(picks);
    if (!v.length) throw new UserError("Nothing to schedule.");
    const r = await commitAutoSchedule(user, v);
    refresh();
    return r;
  });
}
