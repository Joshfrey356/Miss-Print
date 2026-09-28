import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { PoForm } from "@/components/inventory/po-form";
import { getPurchaseOrder, poFormOptions } from "@/lib/inventory/purchasing";
import { openJobsForPicker } from "@/lib/inventory/queries";
import { poNo } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Edit purchase order ${(await params).id}` };
}

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("purchasing.edit");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const d = await getPurchaseOrder(user.tenantId, id);
  if (!d) notFound();
  if (d.po.status !== "draft") redirect(`/inventory/purchase-orders/${id}`);
  const [options, jobs] = await Promise.all([poFormOptions(user.tenantId), openJobsForPicker(user.tenantId)]);
  // Keep a job that's since been completed selectable.
  for (const j of [d.po.jobId ? { id: d.po.jobId, number: d.jobNumber!, title: d.jobTitle ?? "" } : null, ...d.lines.map(({ line, jobNumber }) => (line.jobId ? { id: line.jobId, number: jobNumber!, title: "" } : null))])
    if (j && !jobs.some((x) => x.id === j.id)) jobs.push(j);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={`Edit ${poNo(d.po.number)}`} subtitle={d.vendor.name} back={{ href: `/inventory/purchase-orders/${id}`, label: poNo(d.po.number) }} />
      <PoForm
        id={id}
        options={{ ...options, jobs }}
        initial={{
          vendorId: d.po.vendorId,
          locationId: d.po.locationId,
          expectedOn: d.po.expectedOn,
          jobId: d.po.jobId,
          notes: d.po.notes,
          shippingCents: d.po.shippingCents,
          taxCents: d.po.taxCents,
          lines: d.lines.map(({ line }) => ({ materialId: line.materialId, description: line.description, quantity: line.quantity, unit: line.unit, unitCostCents: line.unitCostCents, jobId: line.jobId })),
        }}
      />
    </div>
  );
}
