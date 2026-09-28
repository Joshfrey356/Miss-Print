import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { fmtQty, unitLabel } from "@/lib/inventory/math";
import { getJobMaterials } from "@/lib/inventory/queries";
import { cn } from "@/lib/utils";
import { UseNowButton } from "./use-now-button";

/**
 * Stock for one job (job page): what's reserved for it and what's been used, with shortages flagged.
 * Renders nothing when the job touches no tracked stock. Place on the job page's Details tab:
 *   <JobMaterialsCard tenantId={user.tenantId} jobId={job.id} canEdit={can(user.role, "inventory.edit")} />
 * (only for roles with inventory.view).
 */
export async function JobMaterialsCard({ tenantId, jobId, canEdit }: { tenantId: number; jobId: number; canEdit: boolean }) {
  const rows = await getJobMaterials(tenantId, jobId);
  if (!rows.length) return null;
  const short = rows.filter((r) => r.short);
  const anyReserved = rows.some((r) => r.reserved > 0);
  return (
    <Card>
      <CardHeader
        title="Materials from stock"
        description={anyReserved ? "Set aside for this job. Taken off the shelf when it moves past printing." : "Taken from stock for this job."}
        action={canEdit && anyReserved ? <UseNowButton jobId={jobId} /> : undefined}
      />
      {short.length > 0 && (
        <p className="mx-5 mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Not enough on the shelf for this job:{" "}
            {short.map((r, i) => (
              <span key={r.materialId}>
                {i > 0 && "; "}
                {r.name} ({fmtQty(r.onHand)} on the shelf{r.reservedAll > r.reserved ? `, ${fmtQty(r.reservedAll)} reserved across open jobs` : ""}
                {r.onOrder > 0 ? `, ${fmtQty(r.onOrder)} on order` : ", none on order"})
              </span>
            ))}
            .
          </span>
        </p>
      )}
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.materialId} className="flex items-start justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <Link href={`/inventory/${r.materialId}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                {r.name}
              </Link>
              <p className="text-sm text-slate-500">
                {fmtQty(r.onHand)} on shelf
                {r.onOrder > 0 ? ` · ${fmtQty(r.onOrder)} on order` : ""}
                {r.binLocation ? ` · ${r.binLocation}` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right">
              {r.reserved > 0 && (
                <p className={cn("font-semibold tabular", r.short ? "text-red-700" : "text-slate-900")}>
                  {r.short && <AlertTriangle className="mr-1 inline size-4 align-[-2px]" />}
                  {fmtQty(r.reserved)} <span className="text-sm font-normal text-slate-500">{unitLabel(r.unit, r.reserved)} reserved</span>
                </p>
              )}
              {r.used > 0 && (
                <p className="text-sm text-emerald-700">
                  <CheckCircle2 className="mr-1 inline size-4 align-[-3px]" />
                  {fmtQty(r.used)} {unitLabel(r.unit, r.used)} used
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
