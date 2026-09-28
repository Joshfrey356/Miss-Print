"use server";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { requirePermission } from "@/lib/auth";
import { runAction, UserError, type ActionResult } from "@/lib/actions";
import { db } from "@/lib/db";
import { materials, vendors } from "@/lib/db/schema";
import { diff, logActivity } from "@/lib/activity";
import { getter, validatePaper } from "@/lib/estimating/catalog-forms";

type Prev = ActionResult | null;

/** Add a paper stock (no id) or save changes to one. */
export async function savePaper(_prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("pricing.edit");
    const checked = validatePaper(getter(fd));
    if (!checked.ok) throw new UserError(checked.error);
    const v = checked.value;
    const id = Number(fd.get("id")) || null;
    if (v.vendorId) {
      const [ven] = await db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.tenantId, user.tenantId), eq(vendors.id, v.vendorId)));
      if (!ven) throw new UserError("Choose a vendor from the list.");
    }
    // Paper is stocked by the sheet; keep the per-sheet cost in step with the cost per 1,000.
    const fields = { ...v, kind: "paper", unit: "sheet", costCents: Math.round(v.costPerMCents / 1000) };
    const [dupe] = await db
      .select({ id: materials.id })
      .from(materials)
      .where(and(eq(materials.tenantId, user.tenantId), sql`lower(${materials.name}) = ${v.name.toLowerCase()}`, id ? sql`${materials.id} <> ${id}` : undefined));
    if (dupe) throw new UserError(`There's already a paper or material called “${v.name}”.`);

    await db.transaction(async (tx) => {
      if (id) {
        const [before] = await tx.select().from(materials).where(and(eq(materials.tenantId, user.tenantId), eq(materials.id, id)));
        if (!before) throw new UserError("That paper no longer exists.");
        const changes = diff(before, fields);
        if (!changes) return;
        await tx.update(materials).set(fields).where(and(eq(materials.tenantId, user.tenantId), eq(materials.id, id)));
        await logActivity(
          { tenantId: user.tenantId, action: "setting.updated", entityType: "setting", entityId: id, actorId: user.id, summary: `Updated paper ${v.name}`, data: { key: "paper", ...changes } },
          tx,
        );
      } else {
        const [row] = await tx.insert(materials).values({ ...fields, tenantId: user.tenantId }).returning({ id: materials.id });
        await logActivity(
          { tenantId: user.tenantId, action: "setting.updated", entityType: "setting", entityId: row!.id, actorId: user.id, summary: `Added paper ${v.name}`, data: { key: "paper", before: null, after: fields } },
          tx,
        );
      }
    });
    revalidatePath("/settings/paper");
  });
}

/** Turn a paper stock off (no longer offered on new estimates) or back on. Never deleted. */
export async function setPaperActive(id: number, active: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("pricing.edit");
    const [before] = await db.select().from(materials).where(and(eq(materials.tenantId, user.tenantId), eq(materials.id, id)));
    if (!before) throw new UserError("That paper no longer exists.");
    if (before.active === active) return;
    await db.transaction(async (tx) => {
      await tx.update(materials).set({ active }).where(and(eq(materials.tenantId, user.tenantId), eq(materials.id, id)));
      await logActivity(
        {
          tenantId: user.tenantId,
          action: "setting.updated",
          entityType: "setting",
          entityId: id,
          actorId: user.id,
          summary: `${active ? "Turned back on" : "Turned off"} paper ${before.name}`,
          data: { key: "paper", before: { active: before.active }, after: { active } },
        },
        tx,
      );
    });
    revalidatePath("/settings/paper");
  }, active ? "Paper turned back on" : "Paper turned off");
}
