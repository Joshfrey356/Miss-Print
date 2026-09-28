import Link from "next/link";
import { PackageCheck } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { StockStatusBadge } from "@/components/inventory/badges";
import { CreateDraftsButton } from "@/components/inventory/reorder-buttons";
import { fmtDate, money } from "@/lib/format";
import { fmtQty, lineAmount, unitLabel } from "@/lib/inventory/math";
import { suggestedOrders } from "@/lib/inventory/queries";
import { poCounts } from "@/lib/inventory/purchasing";
import { cn } from "@/lib/utils";
import { InventoryTabs } from "../_components/section-tabs";

export const metadata = { title: "Suggested orders" };

export default async function ReorderPage() {
  const user = await requirePagePermission("inventory.view");
  const canPurchase = can(user.role, "purchasing.edit");
  const canSeeCost = canPurchase || can(user.role, "margins.view");
  const [groups, pos] = await Promise.all([suggestedOrders(user.tenantId), poCounts(user.tenantId)]);
  const count = groups.reduce((a, g) => a + g.items.length, 0);
  const withVendor = groups.filter((g) => g.vendorId != null).map((g) => g.vendorId!);

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="What to order: items at or under their reorder level, and paper that open jobs need more of than you have."
        actions={canPurchase && withVendor.length > 1 ? <CreateDraftsButton vendorIds={withVendor} label={`Draft all ${withVendor.length} orders`} /> : undefined}
      />
      <InventoryTabs active="reorder" canPurchase={canPurchase} counts={{ pos: pos.open, reorder: count }} />
      {pos.draft > 0 && (
        <p className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[15px] text-slate-700">
          {pos.draft === 1 ? "1 draft purchase order hasn't" : `${pos.draft} draft purchase orders haven't`} been placed yet — what&apos;s on {pos.draft === 1 ? "it" : "them"} counts as coming, so it isn&apos;t
          suggested again.{" "}
          <Link href="/inventory/purchase-orders?status=draft" className="font-medium text-brand-700 hover:underline">
            Review {pos.draft === 1 ? "the draft" : "drafts"} →
          </Link>
        </p>
      )}
      {groups.length === 0 ? (
        <Card>
          <EmptyState icon={PackageCheck} title="Nothing needs ordering right now" description="Items show up here when what you'll have (on hand − reserved + on order) is at or under their reorder level." />
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => {
            const total = g.items.reduce((a, s) => a + lineAmount(s.suggested, s.unitCostCents), 0);
            return (
              <Card key={g.vendorId ?? "none"}>
                <CardHeader
                  title={g.vendorName}
                  description={`${g.items.length} item${g.items.length === 1 ? "" : "s"}${canSeeCost ? ` · about ${money(total)}` : ""}`}
                  action={
                    canPurchase ? (
                      g.vendorId != null ? (
                        <CreateDraftsButton vendorIds={[g.vendorId]} label="Create draft PO" variant={groups.length === 1 ? "primary" : "secondary"} />
                      ) : (
                        <span className="text-sm text-slate-500">Pick a vendor on a new PO</span>
                      )
                    ) : undefined
                  }
                />
                <Table>
                  <THead>
                    <tr>
                      <Th>Item</Th>
                      <Th className="hidden text-right sm:table-cell">Available</Th>
                      <Th className="hidden text-right md:table-cell">On order</Th>
                      <Th className="hidden text-right md:table-cell">Reorder at</Th>
                      <Th className="text-right">Order</Th>
                      {canSeeCost && <Th className="hidden text-right sm:table-cell">Est. cost</Th>}
                    </tr>
                  </THead>
                  <tbody>
                    {g.items.map((s) => (
                      <Tr key={s.id}>
                        <Td>
                          <Link href={`/inventory/${s.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                            {s.name}
                          </Link>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                            <StockStatusBadge status={s.status} />
                            {s.uncovered > 0 && (
                              <span className="text-red-700">
                                jobs need {fmtQty(s.uncovered)} more{s.neededBy ? ` by ${fmtDate(s.neededBy)}` : ""}
                              </span>
                            )}
                          </div>
                        </Td>
                        <Td className={cn("hidden text-right tabular sm:table-cell", s.available < 0 && "font-semibold text-red-700")}>{fmtQty(s.available)}</Td>
                        <Td className="hidden text-right tabular text-slate-600 md:table-cell">{s.onOrder ? fmtQty(s.onOrder) : "—"}</Td>
                        <Td className="hidden text-right tabular text-slate-600 md:table-cell">{s.reorderLevel != null ? fmtQty(s.reorderLevel) : "—"}</Td>
                        <Td className="text-right whitespace-nowrap">
                          <b className="tabular">{fmtQty(s.suggested)}</b> <span className="text-sm text-slate-500">{unitLabel(s.unit, s.suggested)}</span>
                          {canPurchase && g.vendorId == null && (
                            <LinkButton size="sm" variant="ghost" href={`/inventory/purchase-orders/new?material=${s.id}&qty=${s.suggested}`} className="ml-1">
                              Order
                            </LinkButton>
                          )}
                        </Td>
                        {canSeeCost && <Td className="hidden text-right tabular sm:table-cell">{money(lineAmount(s.suggested, s.unitCostCents))}</Td>}
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            );
          })}
          <p className="text-sm text-slate-500">
            Suggested = the item&apos;s usual order quantity, or enough to cover open jobs and get back to the reorder level if that&apos;s more. Paper is rounded up to reams of 500.
            Drafts can be changed before you place them.
          </p>
        </div>
      )}
    </div>
  );
}
