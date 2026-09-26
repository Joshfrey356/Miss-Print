"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, like, sql } from "drizzle-orm";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { runAction, str, UserError, type ActionResult } from "@/lib/actions";
import { db } from "@/lib/db";
import { locations, pricingMethodEnum, pricingRules, productCategories } from "@/lib/db/schema";
import { diff, logActivity } from "@/lib/activity";
import { cleanPricingConfig } from "@/lib/admin/pricing-schema";
import { GROUP_LABELS, PRICING_METHOD_LABELS, slugify } from "@/lib/admin/pricing-labels";

type Prev = ActionResult | null;

const categorySchema = z.object({
  name: z.string().trim().min(2, "Enter a name for this category.").max(80),
  group: z.enum(Object.keys(GROUP_LABELS) as [string, ...string[]], { error: "Choose a group." }),
  defaultLocationId: z.number().int().positive().nullable(),
  defaultNeedsProof: z.boolean(),
  defaultNeedsInstall: z.boolean(),
  active: z.boolean(),
});

export type SavePricingInput = {
  category: z.input<typeof categorySchema>;
  config: unknown;
  notes: string | null;
};

export async function savePricingRule(categoryId: number, input: SavePricingInput): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("pricing.edit");
    const category = categorySchema.parse(input.category);
    const config = cleanPricingConfig(input.config);
    const notes = input.notes?.trim() ? input.notes.trim().slice(0, 5000) : null;
    if (category.defaultLocationId) {
      const [loc] = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, user.tenantId), eq(locations.id, category.defaultLocationId)));
      if (!loc) throw new UserError("Choose a valid location.");
    }
    const [before] = await db.select().from(productCategories).where(and(eq(productCategories.tenantId, user.tenantId), eq(productCategories.id, categoryId)));
    if (!before) throw new UserError("That category no longer exists.");
    const [rule] = await db.select().from(pricingRules).where(and(eq(pricingRules.tenantId, user.tenantId), eq(pricingRules.categoryId, categoryId)));

    const catAfter = { ...category, pricingMethod: config.method };
    const catChanges = diff(before, catAfter);
    const configChanged = JSON.stringify(rule?.config ?? null) !== JSON.stringify(config);
    const notesChanged = (rule?.notes ?? null) !== notes;
    if (!catChanges && !configChanged && !notesChanged) return;

    await db.transaction(async (tx) => {
      await tx.update(productCategories).set(catAfter).where(and(eq(productCategories.tenantId, user.tenantId), eq(productCategories.id, categoryId)));
      if (rule) {
        await tx.update(pricingRules).set({ config, notes, updatedBy: user.id, updatedAt: new Date() }).where(and(eq(pricingRules.tenantId, user.tenantId), eq(pricingRules.id, rule.id)));
      } else {
        await tx.insert(pricingRules).values({ tenantId: user.tenantId, categoryId, config, notes, updatedBy: user.id });
      }
      await logActivity(
        {
          tenantId: user.tenantId,
          action: "pricing.updated",
          entityType: "setting",
          entityId: categoryId,
          actorId: user.id,
          summary: `Updated pricing for ${category.name}`,
          data: {
            before: { ...(catChanges?.before ?? {}), ...(configChanged ? { config: rule?.config ?? null } : {}), ...(notesChanged ? { notes: rule?.notes ?? null } : {}) },
            after: { ...(catChanges?.after ?? {}), ...(configChanged ? { config } : {}), ...(notesChanged ? { notes } : {}) },
          },
        },
        tx,
      );
    });
    revalidatePath("/settings/pricing");
    revalidatePath(`/settings/pricing/${categoryId}`);
  }, "Pricing saved");
}

/**
 * Where a new category's work happens by default: print/design at the shop's customer-facing
 * location (the counter), everything else at its production location (not customer-facing, not
 * OFFSITE). Falls back to the first non-OFFSITE location, then the first by sort order.
 * Miss Print: print/design → MUNSTER, others → HAMMOND. A new shop: MAIN for both.
 */
async function defaultLocationFor(tenantId: number, group: string) {
  const locs = await db
    .select({ id: locations.id, code: locations.code, isCustomerFacing: locations.isCustomerFacing })
    .from(locations)
    .where(eq(locations.tenantId, tenantId))
    .orderBy(asc(locations.sortOrder), asc(locations.id));
  const onSite = locs.filter((l) => l.code !== "OFFSITE");
  const preferred = group === "print" || group === "design" ? onSite.find((l) => l.isCustomerFacing) : onSite.find((l) => !l.isCustomerFacing);
  return preferred ?? onSite[0] ?? locs[0] ?? null;
}

export async function createCategory(_prev: Prev, fd: FormData): Promise<ActionResult> {
  let newId = 0;
  const result = await runAction(async () => {
    const user = await requirePermission("pricing.edit");
    const name = z.string().trim().min(2, "Enter a name for this category.").max(80).parse(str(fd, "name") ?? "");
    const group = z.enum(Object.keys(GROUP_LABELS) as [string, ...string[]], { error: "Choose a group." }).parse(str(fd, "group"));
    const method = z.enum(pricingMethodEnum.enumValues, { error: "Choose how it's priced." }).parse(str(fd, "method"));
    const [dupe] = await db.select({ id: productCategories.id }).from(productCategories).where(and(eq(productCategories.tenantId, user.tenantId), sql`lower(${productCategories.name}) = ${name.toLowerCase()}`));
    if (dupe) throw new UserError(`There's already a category called “${name}”.`);
    const base = slugify(name) || "category";
    const taken = await db.select({ slug: productCategories.slug }).from(productCategories).where(and(eq(productCategories.tenantId, user.tenantId), like(productCategories.slug, `${base}%`)));
    let slug = base;
    for (let i = 2; taken.some((t) => t.slug === slug); i++) slug = `${base}-${i}`;
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${productCategories.sortOrder}), 0)::int` }).from(productCategories).where(eq(productCategories.tenantId, user.tenantId));
    const loc = await defaultLocationFor(user.tenantId, group);
    await db.transaction(async (tx) => {
      const [cat] = await tx
        .insert(productCategories)
        .values({
          tenantId: user.tenantId,
          name,
          slug,
          group,
          pricingMethod: method,
          sortOrder: max + 1,
          defaultLocationId: loc?.id ?? null,
          defaultNeedsInstall: false,
          defaultNeedsProof: true,
        })
        .returning({ id: productCategories.id });
      newId = cat!.id;
      await tx.insert(pricingRules).values({ tenantId: user.tenantId, categoryId: newId, config: { method }, updatedBy: user.id });
      await logActivity(
        {
          tenantId: user.tenantId,
          action: "pricing.updated",
          entityType: "setting",
          entityId: newId,
          actorId: user.id,
          summary: `Added product category ${name} (${PRICING_METHOD_LABELS[method]})`,
          data: { before: null, after: { name, group, method } },
        },
        tx,
      );
    });
    revalidatePath("/settings/pricing");
  });
  if (!result.ok) return result;
  redirect(`/settings/pricing/${newId}?new=1`);
}
