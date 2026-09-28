import { requirePortal } from "@/lib/portal/session";
import { getPortalSettings } from "@/lib/portal/settings";
import { getSettings } from "@/lib/settings";
import { Unavailable } from "@/components/portal/parts";
import { portalJobs } from "@/lib/portal/queries";
import { getJobPrefix } from "@/lib/tenant";
import { jobNo } from "@/lib/format";
import { MessageForm } from "@/components/portal/request-forms";

export const metadata = { title: "Message us" };

export default async function PortalMessagePage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const s = await requirePortal();
  const [prefix, open, past, sp, portal, { company }] = await Promise.all([getJobPrefix(s.tenantId), portalJobs(s, "open", 50), portalJobs(s, "past", 10), searchParams, getPortalSettings(s.tenantId), getSettings(s.tenantId)]);
  if (!portal.features.messages) return <Unavailable title="Messages aren't available online" phone={company.phone} />;
  const jobs = [...open, ...past].map((j) => ({ id: j.id, number: j.number, label: `${jobNo(j.number, prefix)} — ${j.title}` }));
  const picked = jobs.find((j) => String(j.number) === sp.job);
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Message us</h1>
        <p className="mt-1 text-[15px] text-slate-600">Questions, changes, delivery details — we&apos;ll get back to you soon.</p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <MessageForm uploads={portal.features.uploads} jobs={jobs.map(({ id, label }) => ({ id, label }))} defaultJobId={picked?.id ?? null} />
      </div>
    </div>
  );
}
