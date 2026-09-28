"use server";
import { revalidatePath } from "next/cache";
import { and, eq, max } from "drizzle-orm";
import { requirePermission } from "@/lib/auth";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { db } from "@/lib/db";
import { equipment, locations } from "@/lib/db/schema";
import { diff, logActivity } from "@/lib/activity";
import { EQUIPMENT_KIND_LABELS, getter, validateEquipment } from "@/lib/estimating/catalog-forms";

type Prev = ActionResult | null;

/**
 * Scheduling fields (hours a work day, which days), or null when the form didn't include them.
 * Not part of the estimating form checks.
 */
function scheduleFields(fd: FormData): { hoursPerDay: number; workDays: number[] } | null {
  if (fd.get("scheduleFields") !== "1") return null;
  const raw = String(fd.get("hoursPerDay") ?? "").trim().replace(/\s*(hours?|hrs?|h)$/i, "");
  const hoursPerDay = raw === "" ? 8 : Number(raw);
  if (!Number.isFinite(hoursPerDay) || hoursPerDay < 0.5 || hoursPerDay > 24) throw new UserError("Hours per work day must be between 0.5 and 24.");
  const workDays = [...new Set(fd.getAll("workDays").map((d) => Number(d)))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
  return { hoursPerDay: Math.round(hoursPerDay * 4) / 4, workDays };
}

/** Add a press or machine (no id) or save changes to one. */
export async function saveEquipment(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("pricing.edit");
    const checked = validateEquipment(getter(fd));
    if (!checked.ok) throw new UserError(checked.error);
    const sched = scheduleFields(fd) ?? { hoursPerDay: 8, workDays: [1, 2, 3, 4, 5] };
    const hasSchedule = fd.get("scheduleFields") === "1";
    const v = hasSchedule ? { ...checked.value, hoursPerDay: sched.hoursPerDay } : checked.value;
    const id = Number(fd.get("id")) || null;
    if (v.locationId) {
      const [loc] = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, user.tenantId), eq(locations.id, v.locationId)));
      if (!loc) throw new UserError("Choose a location from the list.");
    }
    await db.transaction(async (tx) => {
      if (id) {
        const [before] = await tx.select().from(equipment).where(and(eq(equipment.tenantId, user.tenantId), eq(equipment.id, id)));
        if (!before) throw new UserError("That machine no longer exists.");
        const changes = diff(before, v) ?? { before: {}, after: {} };
        // Work days are a list: compare the values, not the array.
        const workDays = hasSchedule ? sched.workDays : before.workDays;
        if (JSON.stringify([...(before.workDays ?? [])].sort((a, b) => a - b)) !== JSON.stringify(workDays)) {
          changes.before.workDays = before.workDays;
          changes.after.workDays = workDays;
        }
        if (!Object.keys(changes.after).length) return;
        await tx.update(equipment).set({ ...v, workDays }).where(and(eq(equipment.tenantId, user.tenantId), eq(equipment.id, id)));
        await logActivity(
          { tenantId: user.tenantId, action: "setting.updated", entityType: "setting", entityId: id, actorId: user.id, summary: `Updated ${EQUIPMENT_KIND_LABELS[v.kind].toLowerCase()} ${v.name}`, data: { key: "equipment", ...changes } },
          tx,
        );
      } else {
        const [{ last }] = await tx.select({ last: max(equipment.sortOrder) }).from(equipment).where(eq(equipment.tenantId, user.tenantId));
        const [row] = await tx
          .insert(equipment)
          .values({ ...v, workDays: sched.workDays, tenantId: user.tenantId, sortOrder: (last ?? 0) + 1 })
          .returning({ id: equipment.id });
        await logActivity(
          { tenantId: user.tenantId, action: "setting.updated", entityType: "setting", entityId: row!.id, actorId: user.id, summary: `Added ${EQUIPMENT_KIND_LABELS[v.kind].toLowerCase()} ${v.name}`, data: { key: "equipment", before: null, after: { ...v, workDays: sched.workDays } } },
          tx,
        );
      }
    });
    revalidatePath("/settings/equipment");
    revalidatePath("/settings/services");
    revalidatePath("/schedule");
  });
}

/** Turn a machine off (not used for new estimates) or back on. Never deleted. */
export async function setEquipmentActive(id: number, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("pricing.edit");
    const [before] = await db.select().from(equipment).where(and(eq(equipment.tenantId, user.tenantId), eq(equipment.id, id)));
    if (!before) throw new UserError("That machine no longer exists.");
    if (before.active === active) return;
    await db.transaction(async (tx) => {
      await tx.update(equipment).set({ active }).where(and(eq(equipment.tenantId, user.tenantId), eq(equipment.id, id)));
      await logActivity(
        {
          tenantId: user.tenantId,
          action: "setting.updated",
          entityType: "setting",
          entityId: id,
          actorId: user.id,
          summary: `${active ? "Turned back on" : "Turned off"} ${before.name}`,
          data: { key: "equipment", before: { active: before.active }, after: { active } },
        },
        tx,
      );
    });
    revalidatePath("/settings/equipment");
  }, active ? "Turned back on" : "Turned off");
}
