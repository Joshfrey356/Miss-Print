"use server";
import { revalidatePath } from "next/cache";
import { and, eq, max } from "drizzle-orm";
import { requirePermission } from "@/lib/auth";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { db } from "@/lib/db";
import { equipment, operations } from "@/lib/db/schema";
import { diff, logActivity } from "@/lib/activity";
import { getter, validateOperation } from "@/lib/estimating/catalog-forms";

type Prev = ActionResult | null;

/** Add a bindery / finishing service (no id) or save changes to one. */
export async function saveOperation(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("pricing.edit");
    const checked = validateOperation(getter(fd));
    if (!checked.ok) throw new UserError(checked.error);
    const v = checked.value;
    const id = Number(fd.get("id")) || null;
    if (v.equipmentId) {
      const [eq1] = await db.select({ id: equipment.id }).from(equipment).where(and(eq(equipment.tenantId, user.tenantId), eq(equipment.id, v.equipmentId)));
      if (!eq1) throw new UserError("Choose a machine from the list.");
    }
    await db.transaction(async (tx) => {
      if (id) {
        const [before] = await tx.select().from(operations).where(and(eq(operations.tenantId, user.tenantId), eq(operations.id, id)));
        if (!before) throw new UserError("That service no longer exists.");
        const changes = diff(before, v);
        if (!changes) return;
        await tx.update(operations).set(v).where(and(eq(operations.tenantId, user.tenantId), eq(operations.id, id)));
        await logActivity(
          { tenantId: user.tenantId, action: "setting.updated", entityType: "setting", entityId: id, actorId: user.id, summary: `Updated service ${v.name}`, data: { key: "operation", ...changes } },
          tx,
        );
      } else {
        const [{ last }] = await tx.select({ last: max(operations.sortOrder) }).from(operations).where(eq(operations.tenantId, user.tenantId));
        const [row] = await tx
          .insert(operations)
          .values({ ...v, tenantId: user.tenantId, sortOrder: (last ?? 0) + 1 })
          .returning({ id: operations.id });
        await logActivity(
          { tenantId: user.tenantId, action: "setting.updated", entityType: "setting", entityId: row!.id, actorId: user.id, summary: `Added service ${v.name}`, data: { key: "operation", before: null, after: v } },
          tx,
        );
      }
    });
    revalidatePath("/settings/services");
  });
}

/** Turn a service off (not offered on new estimates) or back on. Never deleted. */
export async function setOperationActive(id: number, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("pricing.edit");
    const [before] = await db.select().from(operations).where(and(eq(operations.tenantId, user.tenantId), eq(operations.id, id)));
    if (!before) throw new UserError("That service no longer exists.");
    if (before.active === active) return;
    await db.transaction(async (tx) => {
      await tx.update(operations).set({ active }).where(and(eq(operations.tenantId, user.tenantId), eq(operations.id, id)));
      await logActivity(
        {
          tenantId: user.tenantId,
          action: "setting.updated",
          entityType: "setting",
          entityId: id,
          actorId: user.id,
          summary: `${active ? "Turned back on" : "Turned off"} service ${before.name}`,
          data: { key: "operation", before: { active: before.active }, after: { active } },
        },
        tx,
      );
    });
    revalidatePath("/settings/services");
  }, active ? "Service turned back on" : "Service turned off");
}
