import Link from "next/link";
import { FilePlus2, ClipboardList } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { Chips, withParams } from "@/components/chips";
import { SearchInput } from "@/components/search-input";
import { PoStatusBadge } from "@/components/inventory/badges";
import { fmtDate, jobNo, money, poNo, today } from "@/lib/format";
import { isPoOverdue } from "@/lib/inventory/math";
import { listPurchaseOrders, poCounts, PO_FILTERS, type PoFilter } from "@/lib/inventory/purchasing";
import { getJobPrefix } from "@/lib/tenant";
import { cn } from "@/lib/utils";
import { InventoryTabs } from "../_components/section-tabs";

export const metadata = { title: "Purchase orders" };

const EMPTY: Record<PoFilter, string> = {
  open: "No open purchase orders.",
  draft: "No drafts.",
  ordered: "Nothing is on order.",
  late: "No orders are late.",
  received: "Nothing received yet.",
  cancelled: "No cancelled orders.",
  all: "No purchase orders yet.",
};

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const user = await requirePagePermission("inventory.view");
  const sp = await searchParams;
  const filter: PoFilter = (PO_FILTERS as readonly string[]).includes(sp.status ?? "") ? (sp.status as PoFilter) : "open";
  const canPurchase = can(user.role, "purchasing.edit");
  const canSeeCost = canPurchase || can(user.role, "margins.view");
  const [rows, counts, prefix] = await Promise.all([listPurchaseOrders(user.tenantId, { filter, q: sp.q }), poCounts(user.tenantId), getJobPrefix(user.tenantId)]);
  const t = today();
  const params = { status: filter === "open" ? undefined : filter, q: sp.q };
  const chip = (key: PoFilter, label: string, count?: number, tone?: "red") => ({ key, label, count, tone, href: withParams("/inventory/purchase-orders", params, { status: key === "open" ? undefined : key }) });

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Purchase orders to your vendors: paper, materials and outside work."
        actions={
          canPurchase && (
            <LinkButton href="/inventory/purchase-orders/new" variant="primary">
              <FilePlus2 className="size-4" /> New purchase order
            </LinkButton>
          )
        }
      />
      <InventoryTabs active="pos" canPurchase={canPurchase} counts={{ pos: counts.open }} />
      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Chips
            active={filter}
            items={[
              chip("open", "Open", counts.open),
              chip("draft", "Drafts", counts.draft),
              chip("ordered", "Ordered", counts.ordered),
              chip("late", "Late", counts.late, "red"),
              chip("received", "Received"),
              chip("cancelled", "Cancelled"),
              chip("all", "All"),
            ]}
          />
          <SearchInput placeholder="PO-1001, vendor or item…" className="w-full lg:w-80" />
        </div>
        <Card>
          {rows.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title={EMPTY[filter]}
              description={sp.q ? `Nothing found for “${sp.q}”.` : filter === "open" ? "Order paper and materials from Suggested orders, or start a new purchase order." : undefined}
              action={
                canPurchase && filter === "open" && !sp.q ? (
                  <LinkButton href="/inventory/reorder" variant="primary">
                    See suggested orders
                  </LinkButton>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>PO</Th>
                  <Th>Vendor</Th>
                  <Th className="hidden md:table-cell">Items</Th>
                  <Th className="hidden sm:table-cell">Ordered</Th>
                  <Th>Expected</Th>
                  {canSeeCost && <Th className="hidden text-right sm:table-cell">Total</Th>}
                  <Th>Status</Th>
                </tr>
              </THead>
              <tbody>
                {rows.map((r) => {
                  const late = isPoOverdue(r, t);
                  return (
                    <Tr key={r.id} className="hover:bg-slate-50/70">
                      <Td className="whitespace-nowrap">
                        <Link href={`/inventory/purchase-orders/${r.id}`} className="font-medium text-brand-700 hover:underline">
                          {poNo(r.number)}
                        </Link>
                        {r.jobNumber && <p className="text-xs text-slate-500">for {jobNo(r.jobNumber, prefix)}</p>}
                      </Td>
                      <Td className="max-w-56 truncate text-slate-800">{r.vendorName}</Td>
                      <Td className="hidden max-w-96 md:table-cell">
                        <p className="truncate text-sm text-slate-600" title={r.summary ?? undefined}>
                          {r.summary ?? "—"}
                        </p>
                      </Td>
                      <Td className="hidden whitespace-nowrap text-sm text-slate-600 sm:table-cell">{r.orderedOn ? fmtDate(r.orderedOn) : "—"}</Td>
                      <Td className={cn("whitespace-nowrap text-sm", late ? "font-semibold text-red-700" : "text-slate-600")}>
                        {r.status === "received" ? `in ${fmtDate(r.receivedOn)}` : r.expectedOn ? fmtDate(r.expectedOn) : "—"}
                      </Td>
                      {canSeeCost && <Td className="hidden text-right tabular sm:table-cell">{money(r.totalCents)}</Td>}
                      <Td>
                        <PoStatusBadge status={r.status} late={late} />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
