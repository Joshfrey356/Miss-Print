import { AlertTriangle, Flame, Zap } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { dueLabel, jobNo } from "@/lib/format";
import { STATUS_SHORT } from "@/lib/jobs/workflow";
import { cn } from "@/lib/utils";
import type { JobStatus, Priority } from "@/lib/db/schema";

export type BoardCard = {
  id: number;
  number: number;
  title: string;
  customer: string;
  status: JobStatus;
  priority: Priority;
  dueDate: string | null;
  overdue: boolean;
  owner: string | null;
  ownerColor: string | null;
  locationCode: string | null;
  locationName: string | null;
  itemSummary: string | null;
  hasArtwork: boolean;
};

export function JobCardView({ job, dragging, tv }: { job: BoardCard; dragging?: boolean; tv?: boolean }) {
  const due = dueLabel(job.dueDate);
  return (
    <div
      className={cn(
        "rounded-lg border bg-white p-3 shadow-sm",
        job.overdue ? "border-red-300 ring-1 ring-red-200" : job.priority === "critical" ? "border-red-300" : job.priority === "rush" ? "border-orange-300" : "border-slate-200",
        dragging && "rotate-1 shadow-lg ring-2 ring-brand-400",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn("font-semibold text-brand-700", tv ? "text-lg" : "text-sm")}>{jobNo(job.number)}</span>
        <span className="flex items-center gap-1">
          {job.priority === "rush" && (
            <span className="inline-flex items-center gap-0.5 rounded bg-orange-100 px-1.5 py-0.5 text-[11px] font-semibold text-orange-700">
              <Zap className="size-3" /> RUSH
            </span>
          )}
          {job.priority === "critical" && (
            <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
              <Flame className="size-3" /> CRITICAL
            </span>
          )}
        </span>
      </div>
      <p className={cn("mt-1 font-medium leading-snug text-slate-900", tv ? "text-lg" : "text-[15px]")}>{job.title}</p>
      <p className={cn("truncate text-slate-500", tv ? "text-base" : "text-sm")}>{job.customer}</p>
      {job.itemSummary && !tv && <p className="mt-1 truncate text-xs text-slate-500">{job.itemSummary}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={cn("flex items-center gap-1 text-xs font-medium", job.overdue ? "text-red-600" : due === "Today" ? "text-amber-700" : "text-slate-500", tv && "text-sm")}>
          {job.overdue && <AlertTriangle className="size-3.5" />}
          {job.status === "completed" ? "Done" : due}
        </span>
        <span className="flex items-center gap-1.5">
          {job.locationCode && (
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", job.locationCode === "HAMMOND" ? "bg-teal-50 text-teal-700" : job.locationCode === "OFFSITE" ? "bg-violet-50 text-violet-700" : "bg-brand-50 text-brand-700")}>
              {job.locationName}
            </span>
          )}
          {job.owner && <Avatar name={job.owner} color={job.ownerColor} size="sm" />}
        </span>
      </div>
      {["proof_ready", "waiting_approval", "quality_check", "finishing"].includes(job.status) && !tv && (
        <p className="mt-2 border-t border-slate-100 pt-1.5 text-[11px] font-medium text-slate-500">{STATUS_SHORT[job.status]}</p>
      )}
      {job.status === "approved_for_production" && !job.hasArtwork && (
        <p className="mt-2 flex items-center gap-1 border-t border-slate-100 pt-1.5 text-[11px] font-semibold text-red-600">
          <AlertTriangle className="size-3" /> No artwork on file
        </p>
      )}
    </div>
  );
}

const PRI: Record<Priority, number> = { critical: 0, rush: 1, normal: 2 };
/** "What's next" ordering: overdue, then priority, then due date. */
export function sortCards<T extends { overdue: boolean; priority: Priority; dueDate: string | null; number: number }>(a: T, b: T) {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (PRI[a.priority] !== PRI[b.priority]) return PRI[a.priority] - PRI[b.priority];
  if (a.dueDate !== b.dueDate) return (a.dueDate ?? "9999") < (b.dueDate ?? "9999") ? -1 : 1;
  return a.number - b.number;
}
