import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getBrand } from "@/lib/brand";
import { getSettings } from "@/lib/settings";
import { Logo } from "@/components/logo";
import { PrintButton } from "@/components/print-button";
import { fmtDate, money, poNo } from "@/lib/format";
import { fmtQty, fmtUnitCost, unitLabel } from "@/lib/inventory/math";
import { getPurchaseOrder } from "@/lib/inventory/purchasing";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Print purchase order ${(await params).id}` };
}

/**
 * The vendor's copy of a purchase order, ready to print or save as PDF. People who can't see costs
 * get a receiving copy (quantities only).
 */
export default async function PurchaseOrderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("inventory.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const d = await getPurchaseOrder(user.tenantId, id);
  if (!d) notFound();
  const withCost = can(user.role, "purchasing.edit") || can(user.role, "margins.view");
  const [brand, { company }] = await Promise.all([getBrand(user.tenantId), getSettings(user.tenantId)]);
  const { po, vendor } = d;

  return (
    <div className="mx-auto max-w-3xl bg-white p-6 text-slate-900 sm:p-8 print:max-w-none print:p-0">
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>
      <div className="flex flex-col gap-4 border-b-2 border-slate-900 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Logo brand={brand} />
          <div className="mt-2 text-sm text-slate-600">
            {company.address && <p className="whitespace-pre-line">{company.address}</p>}
            <p>{[company.phone, company.email].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-3xl font-black tracking-tight">{withCost ? "PURCHASE ORDER" : "RECEIVING COPY"}</p>
          <p className="text-lg font-semibold">{poNo(po.number)}</p>
          <p className="text-sm text-slate-600">Date {fmtDate(po.orderedOn ?? po.createdAt.toISOString().slice(0, 10), { year: true, weekday: false })}</p>
          {po.expectedOn && <p className="text-sm text-slate-600">Needed by {fmtDate(po.expectedOn, { year: true, weekday: false })}</p>}
          {po.status === "draft" && <p className="mt-1 text-sm font-semibold text-amber-700">DRAFT — not yet ordered</p>}
          {po.status === "cancelled" && <p className="mt-1 text-sm font-semibold text-red-700">CANCELLED</p>}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 text-[15px] sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vendor</p>
          <p className="font-semibold">{vendor.name}</p>
          {vendor.contactName && <p>{vendor.contactName}</p>}
          {vendor.email && <p className="text-slate-600">{vendor.email}</p>}
          {vendor.phone && <p className="text-slate-600">{vendor.phone}</p>}
          {vendor.accountNumber && <p className="text-slate-600">Our account # {vendor.accountNumber}</p>}
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deliver to</p>
          <p className="font-semibold">{brand.name}</p>
          {d.location ? (
            <>
              <p>{d.location.name}</p>
              {d.location.address && <p className="whitespace-pre-line text-slate-600">{d.location.address}</p>}
            </>
          ) : (
            company.address && <p className="whitespace-pre-line text-slate-600">{company.address}</p>
          )}
        </div>
      </div>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-slate-900 text-left">
            <th className="py-1.5 pr-3">#</th>
            <th className="py-1.5 pr-3">Item</th>
            <th className="py-1.5 pr-3 text-right">Qty</th>
            {withCost && <th className="py-1.5 pr-3 text-right">Unit cost</th>}
            {withCost ? <th className="py-1.5 text-right">Amount</th> : <th className="py-1.5 text-right">Received</th>}
          </tr>
        </thead>
        <tbody>
          {d.lines.map(({ line, sku }, i) => (
            <tr key={line.id} className="border-b border-slate-300 align-top">
              <td className="py-2 pr-3 text-slate-500">{i + 1}</td>
              <td className="py-2 pr-3">
                <p className="font-semibold">{line.description}</p>
                {sku && <p className="text-slate-600">Item # {sku}</p>}
              </td>
              <td className="tabular py-2 pr-3 text-right whitespace-nowrap">
                {fmtQty(line.quantity)} {line.unit ? unitLabel(line.unit, line.quantity) : ""}
              </td>
              {withCost && (
                <td className="tabular py-2 pr-3 text-right whitespace-nowrap">
                  {fmtUnitCost(line.unitCostCents)}
                  {line.unit ? `/${unitLabel(line.unit, 1)}` : ""}
                </td>
              )}
              {withCost ? (
                <td className="tabular py-2 text-right font-medium">{money(line.amountCents)}</td>
              ) : (
                <td className="py-2 text-right">______</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {withCost && (
        <dl className="tabular ml-auto mt-4 grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-right text-[15px]">
          <dt className="text-slate-600">Subtotal</dt>
          <dd>{money(po.subtotalCents)}</dd>
          {po.shippingCents > 0 && (
            <>
              <dt className="text-slate-600">Shipping</dt>
              <dd>{money(po.shippingCents)}</dd>
            </>
          )}
          {po.taxCents > 0 && (
            <>
              <dt className="text-slate-600">Tax</dt>
              <dd>{money(po.taxCents)}</dd>
            </>
          )}
          <dt className="text-lg font-bold">Total</dt>
          <dd className="text-lg font-bold">{money(po.totalCents)}</dd>
        </dl>
      )}

      {po.notes && (
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</p>
          <p className="whitespace-pre-line text-[15px]">{po.notes}</p>
        </div>
      )}
      <p className="mt-8 border-t border-slate-300 pt-3 text-sm text-slate-600">
        Please put {poNo(po.number)} on the packing slip and invoice, and confirm the delivery date{company.email ? ` to ${company.email}` : ""}
        {company.phone ? ` or ${company.phone}` : ""}. Thank you!
      </p>
    </div>
  );
}
