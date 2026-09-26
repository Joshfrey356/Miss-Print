import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { locations, pricingRules, productCategories } from "@/lib/db/schema";
import { GROUP_LABELS, PRICING_METHOD_LABELS, priceSummary } from "@/lib/admin/pricing-labels";
import type { PricingConfig } from "@/lib/pricing/engine";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { SettingsPage } from "../_components/settings-page";
import { AddCategoryButton } from "./add-category";

export const metadata = { title: "Pricing Rules" };

export default async function PricingPage() {
  await requirePagePermission("pricing.edit");
  const rows = await db
    .select({
      id: productCategories.id,
      name: productCategories.name,
      group: productCategories.group,
      method: productCategories.pricingMethod,
      active: productCategories.active,
      location: locations.name,
      config: pricingRules.config,
      notes: pricingRules.notes,
    })
    .from(productCategories)
    .leftJoin(pricingRules, eq(pricingRules.categoryId, productCategories.id))
    .leftJoin(locations, eq(locations.id, productCategories.defaultLocationId))
    .orderBy(asc(productCategories.sortOrder), asc(productCategories.name));

  return (
    <SettingsPage
      wide
      title="Pricing Rules"
      subtitle="How each kind of work is priced. Quotes use these to suggest a price — people always set the final price."
      actions={<AddCategoryButton />}
    >
      <Card>
        <Table>
          <THead>
            <tr>
              <Th>Product category</Th>
              <Th className="hidden md:table-cell">Group</Th>
              <Th>Priced</Th>
              <Th className="hidden sm:table-cell">Starting price</Th>
              <Th className="hidden lg:table-cell">Made at</Th>
              <Th className="hidden sm:table-cell">Status</Th>
              <Th aria-label="Edit" />
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id} className={`relative hover:bg-slate-50 ${r.active ? "" : "text-slate-400"}`}>
                <Td>
                  <Link href={`/settings/pricing/${r.id}`} className="font-medium text-slate-900 after:absolute after:inset-0 hover:text-brand-700">
                    {r.name}
                  </Link>
                  {r.notes && <p className="line-clamp-1 max-w-md text-sm text-slate-500">{r.notes}</p>}
                </Td>
                <Td className="hidden md:table-cell">{GROUP_LABELS[r.group] ?? r.group}</Td>
                <Td className="whitespace-nowrap">{PRICING_METHOD_LABELS[r.method]}</Td>
                <Td className="hidden whitespace-nowrap tabular sm:table-cell">{priceSummary(r.config as PricingConfig | null)}</Td>
                <Td className="hidden lg:table-cell">{r.location ?? "—"}</Td>
                <Td className="hidden sm:table-cell">{r.active ? <Badge tone="green">In use</Badge> : <Badge>Turned off</Badge>}</Td>
                <Td className="w-8 text-right">
                  <ChevronRight className="size-5 text-slate-400" />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </SettingsPage>
  );
}
