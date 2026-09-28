import Link from "next/link";
import { FilePlus2, Package, QrCode } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { Chips, withParams } from "@/components/chips";
import { SearchInput } from "@/components/search-input";
import { StockStatusBadge } from "@/components/inventory/badges";
import { StartTrackingButton } from "@/components/inventory/start-tracking";
import { fmtDate, money } from "@/lib/format";
import { fmtQty, unitLabel, suggestedOrderQty } from "@/lib/inventory/math";
import { listStock, listUntracked } from "@/lib/inventory/queries";
import { poCounts } from "@/lib/inventory/purchasing";
import { cn } from "@/lib/utils";
import { InventoryTabs } from "./_components/section-tabs";

export const metadata = { title: "Inventory" };

const FILTERS = ["all", "low", "paper", "other"] as const;
type Filter = (typeof FILTERS)[number];

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string; track?: string }> }) {
  const user = await requirePagePermission("inventory.view");
  const sp = await searchParams;
  const filter: Filter = (FILTERS as readonly string[]).includes(sp.filter ?? "") ? (sp.filter as Filter) : "all";
  const q = sp.q?.trim().toLowerCase() ?? "";
  const canEdit = can(user.role, "inventory.edit");
  const canPurchase = can(user.role, "purchasing.edit");
  const canSeeCost = canPurchase || can(user.role, "margins.view");
  const [all, untracked, pos] = await Promise.all([listStock(user.tenantId), canEdit ? listUntracked(user.tenantId) : Promise.resolve([]), poCounts(user.tenantId)]);

  const stock = all.filter((s) => s.active);
  const needs = (s: (typeof stock)[number]) => s.status !== "ok";
  const counts = { all: stock.length, low: stock.filter(needs).length, paper: stock.filter((s) => s.kind === "paper").length, other: stock.filter((s) => s.kind !== "paper").length };
  const rows = stock
    .filter((s) => (filter === "low" ? needs(s) : filter === "paper" ? s.kind === "paper" : filter === "other" ? s.kind !== "paper" : true))
    .filter((s) => !q || [s.name, s.sku, s.binLocation, s.vendorName].some((v) => v?.toLowerCase().includes(q)));
  // Problems first, then by name.
  const rank = { short: 0, out: 1, low: 2, ok: 3 } as const;
  rows.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
  const reorderCount = stock.filter((s) => suggestedOrderQty({ ...s, onOrder: s.onOrder + s.onDraft }) > 0).length;
  const value = stock.reduce((a, s) => a + Math.max(0, s.onHand) * s.unitCostCents, 0);
  const onOrderCount = stock.filter((s) => s.onOrder > 0).length;
  const params = { filter: filter === "all" ? undefined : filter, q: sp.q };
  const chip = (key: Filter, label: string, count: number, tone?: "red") => ({ key, label, count, tone, href: withParams("/inventory", params, { filter: key === "all" ? undefined : key }) });

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="What's on the shelf, what jobs need, and what's on order."
        actions={
          <>
            {rows.length > 0 && (
              <LinkButton href={`/inventory/labels?ids=${rows.map((r) => r.id).join(",")}`} prefetch={false}>
                <QrCode className="size-4" /> Shelf labels
              </LinkButton>
            )}
            {canEdit && <StartTrackingButton materials={untracked} initialId={Number(sp.track) || null} variant={stock.length ? "secondary" : "primary"} />}
            {canPurchase && (
              <LinkButton href="/inventory/purchase-orders/new" variant="primary">
                <FilePlus2 className="size-4" /> New purchase order
              </LinkButton>
            )}
          </>
        }
      />
      <InventoryTabs active="stock" canPurchase={canPurchase} counts={{ pos: pos.open, reorder: reorderCount }} />

      {stock.length === 0 ? (
        <Card>
          <EmptyState
            icon={Package}
            title="You're not tracking any stock yet"
            description="Start with the paper you use most: count what's on the shelf, set when to reorder, and jobs will reserve the sheets their estimates need."
            action={canEdit ? <StartTrackingButton materials={untracked} variant="primary" /> : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Chips active={filter} items={[chip("all", "All", counts.all), chip("low", "Low & short", counts.low, "red"), chip("paper", "Paper", counts.paper), chip("other", "Other", counts.other)]} />
            <SearchInput placeholder="Item, SKU, bin or vendor…" className="w-full lg:w-80" />
          </div>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-sm text-slate-600">
              <span>
                <strong className="text-slate-900">{stock.length}</strong> item{stock.length === 1 ? "" : "s"} tracked
                {counts.low > 0 && (
                  <>
                    {" · "}
                    <strong className="text-red-700">{counts.low}</strong> need{counts.low === 1 ? "s" : ""} attention
                  </>
                )}
                {onOrderCount > 0 && <> · {onOrderCount} on order</>}
                {canSeeCost && <> · Stock value <strong className="tabular text-slate-900">{money(Math.round(value))}</strong></>}
              </span>
              {reorderCount > 0 && (
                <Link href="/inventory/reorder" className="font-medium text-brand-700 hover:underline">
                  {reorderCount} to reorder →
                </Link>
              )}
            </div>
            {rows.length === 0 ? (
              <EmptyState compact title={filter === "low" ? "Nothing is low or short. Nice." : "No stock items match."} description={q ? `Nothing found for “${sp.q}”.` : undefined} />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Item</Th>
                    <Th className="hidden text-right sm:table-cell">On hand</Th>
                    <Th className="hidden text-right sm:table-cell">Reserved</Th>
                    <Th className="hidden text-right md:table-cell">On order</Th>
                    <Th className="text-right">Available</Th>
                    <Th className="hidden text-right lg:table-cell">Reorder at</Th>
                    <Th className="hidden sm:table-cell">Status</Th>
                    <Th className="hidden xl:table-cell">Bin</Th>
                    <Th className="hidden 2xl:table-cell">Vendor</Th>
                  </tr>
                </THead>
                <tbody>
                  {rows.map((s) => (
                    <Tr key={s.id} className="hover:bg-slate-50/70">
                      <Td className="max-w-80">
                        <Link href={`/inventory/${s.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                          {s.name}
                        </Link>
                        <p className="truncate text-sm text-slate-500">
                          {unitLabel(s.unit)}
                          {s.sku && ` · SKU ${s.sku}`}
                          {s.binLocation && <span className="xl:hidden"> · {s.binLocation}</span>}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500 sm:hidden">
                          <StockStatusBadge status={s.status} />
                          <span className="tabular">{fmtQty(s.onHand)} on hand{s.reserved ? ` · ${fmtQty(s.reserved)} reserved` : ""}</span>
                        </div>
                      </Td>
                      <Td className="hidden text-right tabular sm:table-cell">{fmtQty(s.onHand)}</Td>
                      <Td className="hidden text-right tabular text-slate-600 sm:table-cell">{s.reserved ? fmtQty(s.reserved) : "—"}</Td>
                      <Td className="hidden text-right tabular text-slate-600 md:table-cell">{s.onOrder ? fmtQty(s.onOrder) : "—"}</Td>
                      <Td className={cn("text-right font-semibold tabular", s.available < 0 ? "text-red-700" : "text-slate-900")}>{fmtQty(s.available)}</Td>
                      <Td className="hidden text-right tabular text-slate-500 lg:table-cell">{s.reorderLevel != null ? fmtQty(s.reorderLevel) : "—"}</Td>
                      <Td className="hidden sm:table-cell">
                        <StockStatusBadge status={s.status} />
                        {s.status === "short" && s.neededBy && <p className="mt-0.5 text-xs text-red-700">needed by {fmtDate(s.neededBy)}</p>}
                      </Td>
                      <Td className="hidden text-sm text-slate-600 xl:table-cell">{s.binLocation ?? "—"}</Td>
                      <Td className="hidden text-sm text-slate-600 2xl:table-cell">{s.vendorName ?? "—"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <p className="text-sm text-slate-500">
            Available = on hand − reserved for open jobs. Jobs reserve stock from their estimate (paper sheets) or their material and size, and it comes off the shelf when the
            job moves past printing.
          </p>
        </div>
      )}
    </div>
  );
}
