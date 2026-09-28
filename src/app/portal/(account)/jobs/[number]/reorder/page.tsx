import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePortal } from "@/lib/portal/session";
import { getPortalSettings } from "@/lib/portal/settings";
import { getSettings } from "@/lib/settings";
import { Unavailable } from "@/components/portal/parts";
import { portalJob } from "@/lib/portal/queries";
import { getJobPrefix } from "@/lib/tenant";
import { fmtSize, jobNo, today } from "@/lib/format";
import { ReorderForm } from "@/components/portal/request-forms";

export const metadata = { title: "Reorder" };

export default async function PortalReorderPage({ params }: { params: Promise<{ number: string }> }) {
  const s = await requirePortal();
  const raw = (await params).number;
  if (!/^\d{1,9}$/.test(raw)) notFound();
  const d = await portalJob(s, Number(raw));
  if (!d) notFound();
  const [portal, { company }] = await Promise.all([getPortalSettings(s.tenantId), getSettings(s.tenantId)]);
  if (!portal.features.reorders) return <Unavailable title="Reordering online isn't available" phone={company.phone}>To reorder, please contact us</Unavailable>;
  const prefix = await getJobPrefix(s.tenantId);
  const single = d.items.length === 1 ? d.items[0]! : null;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link href={`/portal/jobs/${d.job.number}`} className="text-sm text-slate-500 hover:text-slate-800">
          ← {jobNo(d.job.number, prefix)}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Reorder: {d.job.title}</h1>
        {d.items.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[15px] text-slate-600">
            {d.items.map((i) => (
              <li key={i.id}>
                {i.description} — {[`last time ${i.quantity.toLocaleString()}`, fmtSize(i.widthIn, i.heightIn), i.material].filter(Boolean).join(" · ")}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <ReorderForm uploads={portal.features.uploads} jobId={d.job.id} defaultQuantity={single?.quantity ?? null} minDate={today()} />
      </div>
    </div>
  );
}
