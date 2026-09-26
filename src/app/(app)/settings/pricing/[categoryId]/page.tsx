import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requirePagePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { pricingRules, productCategories, users } from "@/lib/db/schema";
import { getLocations, getMaterials } from "@/lib/lookups";
import { getSettings } from "@/lib/settings";
import { fmtDateTime } from "@/lib/format";
import type { PricingConfig } from "@/lib/pricing/engine";
import { SettingsPage } from "../../_components/settings-page";
import { PricingEditor } from "./editor";

export const metadata = { title: "Edit Pricing" };

export default async function EditPricingPage({ params, searchParams }: { params: Promise<{ categoryId: string }>; searchParams: Promise<{ new?: string }> }) {
  await requirePagePermission("pricing.edit");
  const { categoryId } = await params;
  const isNew = (await searchParams).new === "1";
  const id = Number(categoryId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [cat] = await db.select().from(productCategories).where(eq(productCategories.id, id));
  if (!cat) notFound();
  const [[rule], locs, mats, { rules }] = await Promise.all([
    db
      .select({ config: pricingRules.config, notes: pricingRules.notes, updatedAt: pricingRules.updatedAt, by: users.name })
      .from(pricingRules)
      .leftJoin(users, eq(users.id, pricingRules.updatedBy))
      .where(eq(pricingRules.categoryId, id)),
    getLocations(),
    getMaterials(),
    getSettings(),
  ]);
  const config = (rule?.config as PricingConfig | undefined) ?? { method: cat.pricingMethod };

  return (
    <SettingsPage
      wide
      title={cat.name}
      back={{ href: "/settings/pricing", label: "Pricing Rules" }}
      subtitle={
        isNew
          ? "New category added. Fill in how it's priced, try a few examples on the right, then save."
          : rule?.updatedAt
            ? `Last changed ${fmtDateTime(rule.updatedAt)}${rule.by ? ` by ${rule.by}` : ""}.`
            : "Set up how this kind of work is priced."
      }
    >
      <PricingEditor
        categoryId={id}
        category={{
          name: cat.name,
          group: cat.group,
          defaultLocationId: cat.defaultLocationId,
          defaultNeedsProof: cat.defaultNeedsProof,
          defaultNeedsInstall: cat.defaultNeedsInstall,
          active: cat.active,
        }}
        config={{ ...config, method: config.method ?? cat.pricingMethod }}
        notes={rule?.notes ?? ""}
        rules={rules}
        locations={locs.map((l) => ({ id: l.id, name: l.name }))}
        materials={mats.map((m) => ({ id: m.id, name: m.name, unit: m.unit, costCents: m.costCents }))}
      />
    </SettingsPage>
  );
}
