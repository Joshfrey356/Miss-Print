import Link from "next/link";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { fmtDate, jobNo, today } from "@/lib/format";
import { getScheduleSummary } from "@/lib/schedule/queries";
import { hoursLabel, rangeLabel } from "@/lib/schedule/time";
import { getJobPrefix } from "@/lib/tenant";
import { cn } from "@/lib/utils";

/**
 * Dashboard card: today's booked hours per machine, overbooked machines, and bookings that end
 * after their job is due. No prices.
 *
 *   {(can(r, "schedule.edit") || company) && <ScheduleTodayCard tenantId={user.tenantId} />}
 */
export async function ScheduleTodayCard({ tenantId }: { tenantId: number }) {
  const [s, prefix] = await Promise.all([getScheduleSummary(tenantId, today()), getJobPrefix(tenantId)]);
  if (!s.machines.length) return null;
  return (
    <Card className={cn((s.overbooked.length > 0 || s.late.length > 0) && "border-amber-200")}>
      <CardHeader
        title="Machines today"
        description={`${hoursLabel(s.totalBookedMinutes)} hr booked${s.waitingJobs ? ` · ${s.waitingJobs} ${s.waitingJobs === 1 ? "job" : "jobs"} waiting to be scheduled` : ""}`}
        action={
          <Link href="/schedule" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
            <CalendarClock className="size-4" /> Schedule
          </Link>
        }
      />
      <CardBody className="space-y-3">
        <ul className="space-y-2">
          {s.machines.map((m) => {
            const pct = m.capacityMinutes ? Math.min(100, (m.bookedMinutes / m.capacityMinutes) * 100) : m.bookedMinutes ? 100 : 0;
            return (
              <li key={m.id}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium text-slate-800">
                    {m.name}
                    {m.running > 0 && <span className="ml-1.5 text-xs font-semibold text-amber-700">running</span>}
                  </span>
                  <span className={cn("shrink-0 tabular-nums", m.overbooked ? "font-semibold text-red-600" : "text-slate-500")}>
                    {m.capacityMinutes ? `${hoursLabel(m.bookedMinutes)} / ${hoursLabel(m.capacityMinutes)} hr` : m.bookedMinutes ? `${hoursLabel(m.bookedMinutes)} hr · day off` : "Off today"}
                    {m.doubleBooked && " · double-booked"}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className={cn("h-full rounded-full", m.overbooked ? "bg-red-500" : pct >= 85 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
        {s.late.length > 0 && (
          <div className="rounded-lg bg-red-50 px-3 py-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-red-700">
              <AlertTriangle className="size-4" /> Booked after the due date
            </p>
            <ul className="mt-1 space-y-0.5 text-sm text-red-800">
              {s.late.slice(0, 5).map((l) => (
                <li key={l.blockId} className="truncate">
                  <Link href={`/schedule?job=${l.jobId}`} className="font-medium hover:underline">
                    {jobNo(l.jobNumber, prefix)}
                  </Link>{" "}
                  {l.machineName} {rangeLabel(l.start, l.end)} · due {fmtDate(l.dueDate)}
                </li>
              ))}
              {s.late.length > 5 && <li>+ {s.late.length - 5} more</li>}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
