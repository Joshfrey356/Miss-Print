import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { fmtDate } from "@/lib/format";
import { getJobSchedule } from "@/lib/schedule/queries";
import { durationLabel, rangeLabel, ymdAt } from "@/lib/schedule/time";
import { BLOCK_STATUS_LABELS } from "@/lib/schedule/types";

/**
 * Job page card: when this job's work is booked on which machine, what's still waiting, and a
 * "Schedule" button that opens the board with this job highlighted.
 *
 *   <JobScheduleCard tenantId={user.tenantId} jobId={job.id} canEdit={can(r, "schedule.edit")} canView={can(r, "schedule.edit") || can(r, "dashboard.company")} />
 */
export async function JobScheduleCard({ tenantId, jobId, canEdit, canView = true }: { tenantId: number; jobId: number; canEdit: boolean; canView?: boolean }) {
  const { blocks, waiting, status } = await getJobSchedule(tenantId, jobId);
  // Nothing booked and not sold yet (or finished): nothing to show.
  if (!blocks.length && (!waiting.length || !status || ["new", "needs_quote", "quote_sent", "completed", "cancelled"].includes(status))) return null;
  const href = `/schedule?job=${jobId}`;
  const open = blocks.filter((b) => b.status !== "done");
  const done = blocks.length - open.length;
  return (
    <Card>
      <CardHeader
        title="Machine schedule"
        description={
          blocks.length
            ? `${blocks.length} ${blocks.length === 1 ? "booking" : "bookings"}${done ? `, ${done} done` : ""}${waiting.length ? ` · ${waiting.length} waiting` : ""}`
            : "Not on the schedule yet"
        }
        action={
          canEdit || canView ? (
            <LinkButton href={href} size="sm" variant={canEdit && waiting.length ? "primary" : "secondary"}>
              <CalendarClock className="size-4" /> {canEdit && waiting.length ? "Schedule" : "Open schedule"}
            </LinkButton>
          ) : undefined
        }
      />
      <CardBody className="space-y-3">
        {blocks.length > 0 && (
          <ul className="space-y-2">
            {blocks.map((b) => {
              const late = !!b.job?.dueDate && b.status !== "done" && ymdAt(b.end - 1) > b.job.dueDate;
              return (
                <li key={b.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{b.machineName}</span>
                    <Badge tone={b.status === "running" ? "amber" : b.status === "done" ? "green" : "blue"}>
                      {b.status === "running" ? <Play className="size-3" /> : b.status === "done" ? <CheckCircle2 className="size-3" /> : null}
                      {BLOCK_STATUS_LABELS[b.status]}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-700">
                    {canView ? (
                      <Link href={`/schedule?job=${jobId}&view=day&date=${ymdAt(b.start)}`} className="hover:underline">
                        {rangeLabel(b.start, b.end, undefined, { date: true })}
                      </Link>
                    ) : (
                      rangeLabel(b.start, b.end, undefined, { date: true })
                    )}{" "}
                    · {durationLabel((b.end - b.start) / 60000)}
                  </p>
                  <p className="truncate text-sm text-slate-500">
                    {b.title}
                    {b.operatorName ? ` · ${b.operatorName}` : ""}
                  </p>
                  {late && (
                    <p className="mt-0.5 flex items-center gap-1 text-sm font-medium text-red-600">
                      <AlertTriangle className="size-4" /> Ends after the due date ({fmtDate(b.job!.dueDate)})
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {waiting.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Waiting to be scheduled</p>
            <ul className="space-y-1 text-sm text-slate-700">
              {waiting.map((p) => (
                <li key={p.key} className="flex items-baseline justify-between gap-2">
                  <span className="truncate">
                    {p.label} · {p.itemDescription}
                  </span>
                  <span className="shrink-0 text-slate-500">
                    {p.machineName ?? "No machine"} · {durationLabel(p.minutes)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
