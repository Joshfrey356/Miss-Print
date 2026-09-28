import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ClipboardCheck, FilePlus2, MapPin, QrCode, SlidersHorizontal } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { JobStatusBadge } from "@/components/status";
import { PoStatusBadge } from "@/components/inventory/badges";
import { StockStatusBadge } from "@/components/inventory/badges";
import { StockActions } from "@/components/inventory/stock-actions";
import { StartTrackingButton } from "@/components/inventory/start-tracking";
import { dueLabel, fmtDate, fmtDateTime, jobNo, money, poNo, today } from "@/lib/format";
import { fmtDelta, fmtQty, fmtUnitCost, isPoOverdue, qtyWithUnit, remainingOf, unitLabel } from "@/lib/inventory/math";
import { getStockItem, listUntracked, openJobsForPicker } from "@/lib/inventory/queries";
import { getJobPrefix } from "@/lib/tenant";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ materialId: string }> }) {
  return { title: `Stock item ${(await params).materialId}` };
}

const KIND: Record<string, { label: string; icon: typeof ArrowDownLeft; tone: string }> = {
  receive: { label: "Received", icon: ArrowDownLeft, tone: "text-emerald-700" },
  use: { label: "Used", icon: ArrowUpRight, tone: "text-slate-700" },
  adjust: { label: "Adjusted", icon: SlidersHorizontal, tone: "text-amber-700" },
  count: { label: "Counted", icon: ClipboardCheck, tone: "text-brand-700" },
  return: { label: "Returned", icon: ArrowUpRight, tone: "text-slate-700" },
};

export default async function StockItemPage({ params, searchParams }: { params: Promise<{ materialId: string }>; searchParams: Promise<{ scan?: string }> }) {
  const user = await requirePagePermission("inventory.view");
  const id = Number((await params).materialId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const scan = (await searchParams).scan === "1";
  const d = await getStockItem(user.tenantId, id);
  if (!d) notFound();
  const m = d.material;
  const canEdit = can(user.role, "inventory.edit");
  const canPurchase = can(user.role, "purchasing.edit");
  const canSeeCost = canPurchase || can(user.role, "margins.view");
  const prefix = await getJobPrefix(user.tenantId);
  const t = today();

  if (!m.trackInventory) {
    const untracked = canEdit ? await listUntracked(user.tenantId) : [];
    return (
      <div className="mx-auto max-w-xl">
        <Link href="/inventory" className="text-sm text-slate-500 hover:text-slate-800">
          ← Inventory
        </Link>
        <Card className="mt-3">
          <EmptyState
            title={`${m.name} isn't being tracked`}
            description={d.movements.length ? "Tracking was turned off. Its history is kept; start tracking again with a fresh count." : "Count what's on the shelf to start tracking it."}
            action={canEdit ? <StartTrackingButton materials={untracked} initialId={m.id} variant="primary" /> : undefined}
          />
        </Card>
      </div>
    );
  }

  const jobs = canEdit ? await openJobsForPicker(user.tenantId) : [];
  const receivable = d.poLines.filter((l) => l.status === "ordered" || l.status === "partial");
  const draft = d.poLines.find((l) => l.status === "draft");
  const item = { id: m.id, name: m.name, unit: m.unit, onHand: d.level.onHand, reorderLevel: m.reorderLevel, reorderQuantity: m.reorderQuantity, binLocation: m.binLocation };
  const actions = canEdit ? (
    <StockActions
      item={item}
      big={scan}
      showSettings={!scan}
      poLines={receivable.map((l) => ({ lineId: l.lineId, number: l.number, remaining: remainingOf(l), expectedOn: l.expectedOn, vendorName: l.vendorName }))}
      jobs={jobs}
      reservedFor={d.reservations.map((r) => ({ id: r.jobId, number: r.number, title: r.title, quantity: r.quantity }))}
    />
  ) : null;
  const newPoHref = `/inventory/purchase-orders/new?material=${m.id}${d.suggested ? `&qty=${d.suggested}` : ""}`;
  const u = (n: number) => unitLabel(m.unit, n);

  const stats = [
    { label: "On hand", value: fmtQty(d.level.onHand), sub: u(d.level.onHand), strong: true },
    { label: "Reserved for jobs", value: fmtQty(d.level.reserved), sub: d.reservations.length ? `${d.reservations.length} job${d.reservations.length === 1 ? "" : "s"}` : "none" },
    { label: "Available", value: fmtQty(d.available), sub: u(d.available), bad: d.available < 0 },
    { label: "On order", value: fmtQty(d.level.onOrder), sub: receivable.length ? `${receivable.length} PO line${receivable.length === 1 ? "" : "s"}` : "nothing ordered" },
    { label: "Reorder at", value: m.reorderLevel != null ? fmtQty(m.reorderLevel) : "—", sub: m.reorderQuantity ? `order ${fmtQty(m.reorderQuantity)}` : "no usual order" },
  ];

  return (
    <div>
      <Link href="/inventory" className="text-sm text-slate-500 hover:text-slate-800">
        ← Inventory
      </Link>

      {scan ? (
        /* Phone view after scanning a shelf label: the number and two big buttons first. */
        <div className="mx-auto mt-3 max-w-md space-y-4">
          <Card>
            <CardBody className="text-center">
              <h1 className="text-xl font-semibold text-slate-900">{m.name}</h1>
              {m.binLocation && (
                <p className="mt-1 inline-flex items-center gap-1 text-[15px] text-slate-600">
                  <MapPin className="size-4" /> {m.binLocation}
                </p>
              )}
              <p className="mt-3 text-5xl font-bold tracking-tight text-slate-900 tabular">{fmtQty(d.level.onHand)}</p>
              <p className="text-[15px] text-slate-500">{u(d.level.onHand)} on hand</p>
              <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-slate-600">
                <span>
                  Reserved <b className="tabular">{fmtQty(d.level.reserved)}</b>
                </span>
                <span className={cn(d.available < 0 && "font-semibold text-red-700")}>
                  Available <b className="tabular">{fmtQty(d.available)}</b>
                </span>
                {d.level.onOrder > 0 && (
                  <span>
                    On order <b className="tabular">{fmtQty(d.level.onOrder)}</b>
                  </span>
                )}
              </div>
              <div className="mt-3">
                <StockStatusBadge status={d.status} />
              </div>
            </CardBody>
          </Card>
          {actions ?? <p className="text-center text-sm text-slate-500">You can see stock but not change it.</p>}
        </div>
      ) : (
        <div className="mt-2 mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{m.name}</h1>
              <StockStatusBadge status={d.status} />
            </div>
            <p className="mt-1 text-[15px] text-slate-500">
              {[m.kind === "paper" ? m.weight ?? "Paper" : m.kind, `counted in ${u(2)}`, m.sku ? `SKU ${m.sku}` : null, d.vendorName ? `from ${d.vendorName}` : null].filter(Boolean).join(" · ")}
            </p>
            {m.binLocation && (
              <p className="mt-1 inline-flex items-center gap-1 text-[15px] text-slate-700">
                <MapPin className="size-4 text-slate-400" /> {m.binLocation}
              </p>
            )}
          </div>
          <div className="flex flex-col items-start gap-2 lg:items-end">
            {actions}
            <div className="flex flex-wrap gap-2">
              <LinkButton size="sm" variant="ghost" href={`/inventory/labels?ids=${m.id}`} prefetch={false}>
                <QrCode className="size-4" /> Shelf label
              </LinkButton>
              {canPurchase && (
                <LinkButton size="sm" variant="ghost" href={newPoHref}>
                  <FilePlus2 className="size-4" /> Order more
                </LinkButton>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={cn("space-y-6", scan && "mt-6")}>
        {!scan && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {stats.map((s) => (
              <Card key={s.label} className="px-4 py-3">
                <p className="text-sm text-slate-500">{s.label}</p>
                <p className={cn("mt-0.5 text-2xl font-semibold tabular", s.bad ? "text-red-700" : "text-slate-900")}>{s.value}</p>
                <p className="text-xs text-slate-500">{s.sub}</p>
              </Card>
            ))}
          </div>
        )}

        {d.status === "short" && (
          <div className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[15px] text-red-800 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <span>
                Open jobs need <b>{qtyWithUnit(d.level.reserved, m.unit)}</b> but only <b>{fmtQty(d.level.onHand)}</b> are on the shelf.
                {d.level.onOrder > 0 ? ` ${fmtQty(d.level.onOrder)} are on order.` : " Nothing is on order."}
                {d.uncovered > 0 && ` Still ${fmtQty(d.uncovered)} short after that.`}
                {d.uncovered > 0 && draft && ` ${poNo(draft.number)} has ${fmtQty(draft.quantity)} but hasn't been placed yet.`}
              </span>
            </p>
            {canPurchase && d.uncovered > 0 && (draft ? (
              <LinkButton size="sm" variant="danger" href={`/inventory/purchase-orders/${draft.poId}`}>
                Place {poNo(draft.number)}
              </LinkButton>
            ) : d.suggested > 0 ? (
              <LinkButton size="sm" variant="danger" href={newPoHref}>
                Order {fmtQty(d.suggested)} now
              </LinkButton>
            ) : null)}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="min-w-0">
            <CardHeader title="Stock history" description={d.lastCountedAt ? `Last counted ${fmtDateTime(d.lastCountedAt)}.` : "Every delivery, use, correction and count."} />
            {d.movements.length === 0 ? (
              <EmptyState compact title="No stock changes yet" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>When</Th>
                    <Th>What</Th>
                    <Th className="text-right">Change</Th>
                    <Th className="hidden text-right sm:table-cell">Balance</Th>
                    <Th className="hidden md:table-cell">Who</Th>
                  </tr>
                </THead>
                <tbody>
                  {d.movements.map((mv) => {
                    const k = KIND[mv.kind] ?? KIND.adjust!;
                    const Icon = k.icon;
                    return (
                      <Tr key={mv.id}>
                        <Td className="whitespace-nowrap text-sm text-slate-600">{fmtDateTime(mv.createdAt)}</Td>
                        <Td className="max-w-96">
                          <span className={cn("inline-flex items-center gap-1.5 font-medium", k.tone)}>
                            <Icon className="size-4" /> {k.label}
                          </span>
                          {(mv.jobNumber || mv.poNumber) && (
                            <span className="ml-2 text-sm">
                              {mv.jobNumber && (
                                <Link href={`/jobs/${mv.jobNumber}`} className="text-brand-700 hover:underline">
                                  {jobNo(mv.jobNumber, prefix)}
                                </Link>
                              )}
                              {mv.jobNumber && mv.poNumber && " · "}
                              {mv.poNumber && (
                                <Link href={`/inventory/purchase-orders/${mv.poId}`} className="text-brand-700 hover:underline">
                                  {poNo(mv.poNumber)}
                                </Link>
                              )}
                            </span>
                          )}
                          {mv.note && <p className="text-sm text-slate-500">{mv.note}</p>}
                          <p className="text-xs text-slate-400 md:hidden">{mv.who ?? "System"}</p>
                        </Td>
                        <Td className={cn("text-right font-semibold tabular", mv.quantity < 0 ? "text-slate-900" : mv.quantity > 0 ? "text-emerald-700" : "text-slate-400")}>
                          {mv.quantity === 0 ? "±0" : fmtDelta(mv.quantity)}
                        </Td>
                        <Td className="hidden text-right tabular text-slate-600 sm:table-cell">{fmtQty(mv.balanceAfter)}</Td>
                        <Td className="hidden text-sm text-slate-600 md:table-cell">{mv.who ?? "System"}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Reserved for jobs" description="Set aside from each job's estimate or material. Taken off the shelf when the job is printed." />
              {d.reservations.length === 0 ? (
                <EmptyState compact title="No open jobs need this right now" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {d.reservations.map((r) => {
                    const late = !!r.dueDate && r.dueDate < t;
                    return (
                      <li key={r.jobId} className="flex items-start justify-between gap-3 px-5 py-3">
                        <div className="min-w-0">
                          <Link href={`/jobs/${r.number}`} className="font-medium text-brand-700 hover:underline">
                            {jobNo(r.number, prefix)}
                          </Link>
                          <p className="truncate text-sm text-slate-700">{r.title}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                            <JobStatusBadge status={r.status} />
                            {r.dueDate && <span className={cn(late ? "font-semibold text-red-700" : "text-slate-500")}>Due {dueLabel(r.dueDate)}</span>}
                          </div>
                        </div>
                        <p className="shrink-0 text-right font-semibold tabular text-slate-900">
                          {fmtQty(r.quantity)}
                          <span className="block text-xs font-normal text-slate-500">{u(r.quantity)}</span>
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader
                title="On order"
                action={
                  canPurchase ? (
                    <Link href={newPoHref} className="text-sm font-medium text-brand-600 hover:underline">
                      New order
                    </Link>
                  ) : undefined
                }
              />
              {d.poLines.length === 0 ? (
                <EmptyState compact title="Nothing on order" description={d.suggested > 0 ? `Suggested: order ${qtyWithUnit(d.suggested, m.unit)}.` : undefined} />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {d.poLines.map((l) => (
                    <li key={l.lineId} className="flex items-start justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <Link href={`/inventory/purchase-orders/${l.poId}`} className="font-medium text-brand-700 hover:underline">
                          {poNo(l.number)}
                        </Link>{" "}
                        <span className="text-sm text-slate-600">· {l.vendorName}</span>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <PoStatusBadge status={l.status} late={isPoOverdue(l, t)} />
                          {l.expectedOn && <span>expected {fmtDate(l.expectedOn)}</span>}
                        </div>
                      </div>
                      <p className="shrink-0 text-right font-semibold tabular text-slate-900">
                        {fmtQty(remainingOf(l))}
                        <span className="block text-xs font-normal text-slate-500">
                          {l.receivedQuantity > 0 ? `of ${fmtQty(l.quantity)} · ` : ""}
                          {u(remainingOf(l))}
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {canSeeCost && (
              <Card>
                <CardHeader title="Cost" />
                <CardBody className="space-y-1.5 text-[15px]">
                  <p className="flex justify-between gap-3">
                    <span className="text-slate-500">Our cost per {unitLabel(m.unit, 1)}</span>
                    <span className="tabular">{fmtUnitCost(d.unitCostCents)}</span>
                  </p>
                  {m.unit === "sheet" && m.costPerMCents != null && (
                    <p className="flex justify-between gap-3">
                      <span className="text-slate-500">Per 1,000 sheets</span>
                      <span className="tabular">{money(m.costPerMCents)}</span>
                    </p>
                  )}
                  {d.lastPo && (
                    <p className="flex justify-between gap-3">
                      <span className="text-slate-500">Last paid ({poNo(d.lastPo.number)})</span>
                      <span className="tabular">{fmtUnitCost(d.lastPo.unitCostCents)}</span>
                    </p>
                  )}
                  <p className="flex justify-between gap-3 border-t border-slate-100 pt-1.5">
                    <span className="text-slate-500">Value on hand</span>
                    <span className="font-semibold tabular">{money(Math.round(Math.max(0, d.level.onHand) * d.unitCostCents))}</span>
                  </p>
                </CardBody>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
