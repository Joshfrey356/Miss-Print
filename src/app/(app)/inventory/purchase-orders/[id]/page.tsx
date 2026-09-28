import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { activityLogs, users } from "@/lib/db/schema";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { PoStatusBadge } from "@/components/inventory/badges";
import { PoActions } from "@/components/inventory/po-actions";
import { fmtDate, fmtDateTime, jobNo, money, poNo, today } from "@/lib/format";
import { fmtQty, fmtUnitCost, isPoOverdue, remainingOf, unitLabel } from "@/lib/inventory/math";
import { getPurchaseOrder, previewPoEmail } from "@/lib/inventory/purchasing";
import { getJobPrefix } from "@/lib/tenant";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Purchase order ${(await params).id}` };
}

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("inventory.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const d = await getPurchaseOrder(user.tenantId, id);
  if (!d) notFound();
  const canPurchase = can(user.role, "purchasing.edit");
  const canSeeCost = canPurchase || can(user.role, "margins.view");
  const { po, vendor } = d;
  const [prefix, history, preview] = await Promise.all([
    getJobPrefix(user.tenantId),
    db
      .select({ id: activityLogs.id, summary: activityLogs.summary, createdAt: activityLogs.createdAt, who: users.name })
      .from(activityLogs)
      .leftJoin(users, and(eq(users.tenantId, activityLogs.tenantId), eq(users.id, activityLogs.actorId)))
      .where(and(eq(activityLogs.tenantId, user.tenantId), eq(activityLogs.entityType, "purchase_order"), eq(activityLogs.entityId, po.id)))
      .orderBy(desc(activityLogs.createdAt))
      .limit(50),
    canPurchase && po.status !== "cancelled" && po.status !== "received" ? previewPoEmail(user.tenantId, po.id) : Promise.resolve(null),
  ]);
  const late = isPoOverdue(po, today());
  const anyReceived = d.lines.some(({ line }) => line.receivedQuantity > 0);

  return (
    <div>
      <Link href="/inventory/purchase-orders" className="text-sm text-slate-500 hover:text-slate-800">
        ← Purchase orders
      </Link>
      <div className="mt-2 mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{poNo(po.number)}</h1>
            <PoStatusBadge status={po.status} late={late} />
          </div>
          <p className="mt-1 text-[15px] text-slate-600">
            {vendor.name}
            {d.jobNumber && (
              <>
                {" · for "}
                <Link href={`/jobs/${d.jobNumber}`} className="font-medium text-brand-700 hover:underline">
                  {jobNo(d.jobNumber, prefix)}
                </Link>{" "}
                {d.jobTitle}
              </>
            )}
          </p>
          <p className="mt-0.5 text-sm text-slate-500">
            Created {fmtDateTime(po.createdAt)}
            {d.createdByName ? ` by ${d.createdByName}` : ""}
            {po.sentAt ? ` · emailed ${fmtDateTime(po.sentAt)}` : ""}
          </p>
        </div>
        <PoActions
          po={{ id: po.id, number: po.number, status: po.status, sentAt: po.sentAt?.toISOString() ?? null }}
          lines={d.lines.map(({ line, tracked }) => ({ id: line.id, description: line.description, quantity: line.quantity, receivedQuantity: line.receivedQuantity, unit: line.unit, stock: !!line.materialId && !!tracked }))}
          vendor={{ name: vendor.name, email: vendor.email }}
          emailPreview={preview}
          canPurchase={canPurchase}
          canReceive={can(user.role, "inventory.edit")}
          canCancel={canPurchase && !anyReceived}
        />
      </div>

      {po.status === "draft" && (
        <p className="mb-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[15px] text-slate-700">
          This is a draft. Nothing has been sent to {vendor.name} yet{canPurchase ? " — click Place order when it's ready." : "."}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Items" />
            <Table>
              <THead>
                <tr>
                  <Th>Item</Th>
                  <Th className="text-right">Ordered</Th>
                  <Th className="text-right">Received</Th>
                  {canSeeCost && <Th className="hidden text-right md:table-cell">Cost</Th>}
                  {canSeeCost && <Th className="text-right">Amount</Th>}
                </tr>
              </THead>
              <tbody>
                {d.lines.map(({ line, materialName, sku, tracked, jobNumber }) => {
                  const left = remainingOf(line);
                  return (
                    <Tr key={line.id}>
                      <Td className="max-w-96">
                        {line.materialId && tracked ? (
                          <Link href={`/inventory/${line.materialId}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                            {line.description}
                          </Link>
                        ) : (
                          <span className="font-medium text-slate-900">{line.description}</span>
                        )}
                        <p className="text-sm text-slate-500">
                          {[
                            line.materialId ? (tracked ? "Stock item" : materialName ? "Material (not tracked)" : null) : "Other / outside service",
                            sku ? `item # ${sku}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                          {jobNumber && (
                            <>
                              {" · for "}
                              <Link href={`/jobs/${jobNumber}`} className="text-brand-700 hover:underline">
                                {jobNo(jobNumber, prefix)}
                              </Link>
                            </>
                          )}
                        </p>
                      </Td>
                      <Td className="text-right tabular whitespace-nowrap">
                        {fmtQty(line.quantity)} <span className="text-sm text-slate-500">{line.unit ? unitLabel(line.unit, line.quantity) : ""}</span>
                      </Td>
                      <Td className="text-right tabular whitespace-nowrap">
                        <span className={cn(line.receivedQuantity >= line.quantity ? "font-medium text-emerald-700" : line.receivedQuantity > 0 ? "font-medium text-amber-700" : "text-slate-400")}>
                          {fmtQty(line.receivedQuantity)}
                        </span>
                        {po.status !== "draft" && po.status !== "cancelled" && left > 0 && line.receivedQuantity > 0 && <p className="text-xs text-slate-500">{fmtQty(left)} to come</p>}
                      </Td>
                      {canSeeCost && (
                        <Td className="hidden text-right tabular text-slate-600 md:table-cell">
                          {fmtUnitCost(line.unitCostCents)}
                          {line.unit && <span className="text-xs text-slate-400">/{unitLabel(line.unit, 1)}</span>}
                        </Td>
                      )}
                      {canSeeCost && <Td className="text-right tabular">{money(line.amountCents)}</Td>}
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            {canSeeCost && (
              <div className="ml-auto max-w-xs space-y-1 border-t border-slate-100 px-5 py-3 text-[15px]">
                <p className="flex justify-between">
                  <span className="text-slate-500">Items</span>
                  <span className="tabular">{money(po.subtotalCents)}</span>
                </p>
                {po.shippingCents > 0 && (
                  <p className="flex justify-between">
                    <span className="text-slate-500">Shipping</span>
                    <span className="tabular">{money(po.shippingCents)}</span>
                  </p>
                )}
                {po.taxCents > 0 && (
                  <p className="flex justify-between">
                    <span className="text-slate-500">Tax</span>
                    <span className="tabular">{money(po.taxCents)}</span>
                  </p>
                )}
                <p className="flex justify-between border-t border-slate-100 pt-1 font-semibold">
                  <span>Total</span>
                  <span className="tabular">{money(po.totalCents)}</span>
                </p>
              </div>
            )}
          </Card>
          {po.notes && (
            <Card>
              <CardHeader title="Notes for the vendor" />
              <CardBody>
                <p className="whitespace-pre-line text-[15px] text-slate-700">{po.notes}</p>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
                <dt className="text-slate-500">Vendor</dt>
                <dd className="min-w-0">
                  <p className="font-medium">{vendor.name}</p>
                  {vendor.contactName && <p className="text-sm text-slate-600">{vendor.contactName}</p>}
                  {vendor.email && (
                    <a href={`mailto:${vendor.email}`} className="block truncate text-sm text-brand-700 hover:underline">
                      {vendor.email}
                    </a>
                  )}
                  {vendor.phone && (
                    <a href={`tel:${vendor.phone}`} className="block text-sm text-brand-700 hover:underline">
                      {vendor.phone}
                    </a>
                  )}
                  {vendor.accountNumber && <p className="text-sm text-slate-600">Account # {vendor.accountNumber}</p>}
                </dd>
                <dt className="text-slate-500">Deliver to</dt>
                <dd>{d.location?.name ?? "—"}</dd>
                <dt className="text-slate-500">Ordered</dt>
                <dd>{po.orderedOn ? fmtDate(po.orderedOn, { year: true }) : "Not yet"}</dd>
                <dt className="text-slate-500">Expected</dt>
                <dd className={cn(late && "font-semibold text-red-700")}>{po.expectedOn ? fmtDate(po.expectedOn, { year: true }) : "—"}</dd>
                {po.receivedOn && (
                  <>
                    <dt className="text-slate-500">Received</dt>
                    <dd>{fmtDate(po.receivedOn, { year: true })}</dd>
                  </>
                )}
                {po.cancelledAt && (
                  <>
                    <dt className="text-slate-500">Cancelled</dt>
                    <dd>{fmtDateTime(po.cancelledAt)}</dd>
                  </>
                )}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <CardBody>
              {history.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing yet.</p>
              ) : (
                <ol className="space-y-3">
                  {history.map((h) => (
                    <li key={h.id} className="text-[15px]">
                      <p className="text-slate-800">{h.summary}</p>
                      <p className="text-xs text-slate-500">
                        {fmtDateTime(h.createdAt)}
                        {h.who ? ` · ${h.who}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
