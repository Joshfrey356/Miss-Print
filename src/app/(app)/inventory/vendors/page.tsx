import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Store } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { materials, purchaseOrders, vendors } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { AddVendorButton, EditVendorButton } from "@/components/inventory/vendor-list";
import { poCounts } from "@/lib/inventory/purchasing";
import { InventoryTabs } from "../_components/section-tabs";

export const metadata = { title: "Vendors" };

export default async function VendorsPage() {
  const user = await requirePagePermission("purchasing.edit");
  const [rows, items, open, pos] = await Promise.all([
    db.select().from(vendors).where(and(eq(vendors.tenantId, user.tenantId), isNull(vendors.archivedAt))).orderBy(asc(vendors.name)),
    db
      .select({ vendorId: materials.vendorId, n: sql<number>`count(*)::int` })
      .from(materials)
      .where(and(eq(materials.tenantId, user.tenantId), eq(materials.active, true)))
      .groupBy(materials.vendorId),
    db
      .select({ vendorId: purchaseOrders.vendorId, n: sql<number>`count(*)::int` })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.tenantId, user.tenantId), inArray(purchaseOrders.status, ["draft", "ordered", "partial"])))
      .groupBy(purchaseOrders.vendorId),
    poCounts(user.tenantId),
  ]);
  const itemCount = new Map(items.map((i) => [i.vendorId, i.n]));
  const openCount = new Map(open.map((i) => [i.vendorId, i.n]));
  return (
    <div>
      <PageHeader title="Inventory" subtitle="The vendors you buy paper, materials and outside work from." actions={<AddVendorButton />} />
      <InventoryTabs active="vendors" canPurchase counts={{ pos: pos.open }} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={Store} title="No vendors yet" description="Add the companies you buy from. Their email is where purchase orders go." action={<AddVendorButton />} />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Vendor</Th>
                <Th className="hidden md:table-cell">Email for orders</Th>
                <Th className="hidden lg:table-cell">Phone</Th>
                <Th className="hidden text-right sm:table-cell">Items</Th>
                <Th className="hidden text-right sm:table-cell">Open POs</Th>
                <Th aria-label="Actions" />
              </tr>
            </THead>
            <tbody>
              {rows.map((v) => (
                <Tr key={v.id}>
                  <Td>
                    <p className="font-medium text-slate-900">{v.name}</p>
                    <p className="text-sm text-slate-500">
                      {[v.contactName, v.accountNumber ? `acct ${v.accountNumber}` : null].filter(Boolean).join(" · ")}
                      <span className="md:hidden">{v.email ? ` ${v.email}` : ""}</span>
                    </p>
                    {v.notes && <p className="line-clamp-1 text-sm text-slate-500">{v.notes}</p>}
                  </Td>
                  <Td className="hidden md:table-cell">{v.email ?? <span className="text-sm text-amber-700">Add an email to send POs</span>}</Td>
                  <Td className="hidden whitespace-nowrap lg:table-cell">{v.phone ?? "—"}</Td>
                  <Td className="hidden text-right tabular sm:table-cell">{itemCount.get(v.id) ?? 0}</Td>
                  <Td className="hidden text-right tabular sm:table-cell">{openCount.get(v.id) ?? 0}</Td>
                  <Td className="w-px">
                    <EditVendorButton vendor={{ id: v.id, name: v.name, contactName: v.contactName, email: v.email, phone: v.phone, accountNumber: v.accountNumber, website: v.website, notes: v.notes }} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
