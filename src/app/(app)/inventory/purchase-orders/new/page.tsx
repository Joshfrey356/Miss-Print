import { requirePagePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { PoForm, type PoFormValue } from "@/components/inventory/po-form";
import { poFormOptions } from "@/lib/inventory/purchasing";
import { openJobsForPicker } from "@/lib/inventory/queries";
import { parseQty } from "@/lib/inventory/math";

export const metadata = { title: "New purchase order" };

/** New PO. ?material=<id>&qty=<n> starts with that item (from a stock item's "Order more"); ?job=<id> charges it to a job. */
export default async function NewPurchaseOrderPage({ searchParams }: { searchParams: Promise<{ material?: string; qty?: string; vendor?: string; job?: string }> }) {
  const user = await requirePagePermission("purchasing.edit");
  const sp = await searchParams;
  const [options, jobs] = await Promise.all([poFormOptions(user.tenantId), openJobsForPicker(user.tenantId)]);
  const m = options.materials.find((x) => x.id === Number(sp.material));
  const job = jobs.find((j) => j.id === Number(sp.job));
  const vendorId = options.vendors.find((v) => v.id === Number(sp.vendor))?.id ?? (m?.vendorId && options.vendors.some((v) => v.id === m.vendorId) ? m.vendorId : null);
  const initial: PoFormValue = {
    vendorId,
    locationId: null,
    expectedOn: null,
    jobId: job?.id ?? null,
    notes: null,
    shippingCents: 0,
    taxCents: 0,
    lines: m ? [{ materialId: m.id, description: m.name, quantity: parseQty(sp.qty ?? "") ?? 0, unit: m.unit, unitCostCents: m.unitCostCents, jobId: null }] : [],
  };
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="New purchase order" subtitle="Saved as a draft. Place the order when it's ready — by email or phone." back={{ href: "/inventory/purchase-orders", label: "Purchase orders" }} />
      <PoForm id={null} initial={initial} options={{ ...options, jobs }} />
    </div>
  );
}
