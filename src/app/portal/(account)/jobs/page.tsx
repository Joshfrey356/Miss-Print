import Link from "next/link";
import { CalendarClock, RotateCcw } from "lucide-react";
import { requirePortal } from "@/lib/portal/session";
import { getPortalSettings } from "@/lib/portal/settings";
import { portalJobs } from "@/lib/portal/queries";
import { getJobPrefix } from "@/lib/tenant";
import { fmtDate, jobNo, today } from "@/lib/format";
import { cn } from "@/lib/utils";
import { dueText, Empty, JobStatusPill, RowLink, Section } from "@/components/portal/parts";

export const metadata = { title: "Orders" };

export default async function PortalJobsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const s = await requirePortal();
  const view = (await searchParams).view === "past" ? "past" : "open";
  const [prefix, rows, portal] = await Promise.all([getJobPrefix(s.tenantId), portalJobs(s, view, 200), getPortalSettings(s.tenantId)]);
  const now = today();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Your orders</h1>
      <div className="flex gap-2">
        {(["open", "past"] as const).map((v) => (
          <Link key={v} href={v === "open" ? "/portal/jobs" : "/portal/jobs?view=past"} className={cn("inline-flex h-10 items-center rounded-full border px-4 text-[15px] font-medium", view === v ? "border-brand-500 bg-brand-500 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}>
            {v === "open" ? "In progress" : "Finished"}
          </Link>
        ))}
      </div>
      <Section title={view === "open" ? "In progress" : "Finished"}>
        {rows.length === 0 ? (
          <Empty>{view === "open" ? "You have no orders in progress." : "No finished orders yet."}</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((j) =>
              view === "past" ? (
                <li key={j.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <Link href={`/portal/jobs/${j.number}`} className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium text-slate-900 hover:underline">{j.title}</p>
                    <p className="text-sm text-slate-500">
                      {jobNo(j.number, prefix)}
                      {j.completedAt ? ` · finished ${fmtDate(j.completedAt.toISOString().slice(0, 10), { year: true })}` : ""}
                    </p>
                  </Link>
                  {portal.features.reorders && <Link href={`/portal/jobs/${j.number}/reorder`} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50">
                    <RotateCcw className="size-4" /> Reorder
                  </Link>}
                </li>
              ) : (
                <li key={j.id}>
                  <RowLink href={`/portal/jobs/${j.number}`}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-[15px] font-medium text-slate-900">{j.title}</p>
                      <JobStatusPill status={j.status} fulfillment={j.fulfillment} />
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-slate-500">
                      <span>{jobNo(j.number, prefix)}</span>
                      {j.dueDate && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="size-3.5" /> {dueText(j.dueDate, now)}
                        </span>
                      )}
                    </p>
                  </RowLink>
                </li>
              ),
            )}
          </ul>
        )}
      </Section>
    </div>
  );
}
