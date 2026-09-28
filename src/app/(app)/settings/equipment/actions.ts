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

/** Add a press or machine (no id) or save changes to one. */
export async function saveEquipment(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("pricing.edit");
    const checked = validateEquipment(getter(fd));
    if (!checked.ok) throw new UserError(checked.error);
    const v = checked.value;
    const id = Number(fd.get("id")) || null;
    if (v.locationId) {
      const [loc] = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, user.tenantId), eq(locations.id, v.locationId)));
      if (!loc) throw new UserError("Choose a location from the list.");
    }
    await db.transaction(async (tx) => {
      if (id) {
        const [before] = await tx.select().from(equipment).where(and(eq(equipment.tenantId, user.tenantId), eq(equipment.id, id)));
        if (!before) throw new UserError("That machine no longer exists.");
        const changes = diff(before, v);
        if (!changes) return;
        await tx.update(equipment).set(v).where(and(eq(equipment.tenantId, user.tenantId), eq(equipment.id, id)));
        await logActivity(
          { tenantId: user.tenantId, action: "setting.updated", entityType: "setting", entityId: id, actorId: user.id, summary: `Updated ${EQUIPMENT_KIND_LABELS[v.kind].toLowerCase()} ${v.name}`, data: { key: "equipment", ...changes } },
          tx,
        );
      } else {
        const [{ last }] = await tx.select({ last: max(equipment.sortOrder) }).from(equipment).where(eq(equipment.tenantId, user.tenantId));
        const [row] = await tx
          .insert(equipment)
          .values({ ...v, tenantId: user.tenantId, sortOrder: (last ?? 0) + 1 })
          .returning({ id: equipment.id });
        await logActivity(
          { tenantId: user.tenantId, action: "setting.updated", entityType: "setting", entityId: row!.id, actorId: user.id, summary: `Added ${EQUIPMENT_KIND_LABELS[v.kind].toLowerCase()} ${v.name}`, data: { key: "equipment", before: null, after: v } },
          tx,
        );
      }
    });
    revalidatePath("/settings/equipment");
    revalidatePath("/settings/services");
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
