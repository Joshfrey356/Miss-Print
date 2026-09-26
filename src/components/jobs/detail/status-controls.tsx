"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Archive, Ban, ChevronDown, MoreHorizontal, PauseCircle, PlayCircle, Printer, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { useServerAction } from "@/components/use-action";
import { STATUS_LABELS, nextStatus, nextStepLabel, type WorkflowJob } from "@/lib/jobs/workflow";
import { advanceJob, archiveJob, setJobStatus } from "@/app/(app)/jobs/actions";
import type { JobStatus } from "@/lib/db/schema";

const GROUPS: { label: string; statuses: JobStatus[] }[] = [
  { label: "Getting started", statuses: ["new", "needs_quote", "quote_sent", "approved"] },
  { label: "Artwork & proof", statuses: ["waiting_artwork", "design", "proof_ready", "waiting_approval"] },
  { label: "Production", statuses: ["approved_for_production", "production", "finishing", "quality_check"] },
  { label: "Finish", statuses: ["ready_pickup", "scheduled_delivery", "scheduled_install", "completed"] },
];

export function StatusControls({
  job,
  canStatus,
  canEdit,
  canReorder,
  onReorder,
  number,
}: {
  job: WorkflowJob & { id: number };
  canStatus: boolean;
  canEdit: boolean;
  canReorder: boolean;
  onReorder: () => void;
  number: number;
}) {
  const router = useRouter();
  const [pending, run] = useServerAction();
  const next = nextStatus(job);
  const label = nextStepLabel(job);
  const [confirm, setConfirm] = useState<null | "cancel" | "archive">(null);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 xl:flex-nowrap">
      {canStatus && next && label && (
        <Button variant={next === "completed" ? "success" : "primary"} size="lg" disabled={pending} onClick={() => run(() => advanceJob(job.id), { success: `Moved to ${STATUS_LABELS[next]}` })}>
          {label}
          <ArrowRight className="size-4" />
        </Button>
      )}
      {job.status === "completed" && canReorder && (
        <Button variant="primary" size="lg" onClick={onReorder}>
          <RotateCcw className="size-4" /> Reorder
        </Button>
      )}
      {canStatus && (
        <Dropdown>
          <DropdownTrigger asChild>
            <Button size="lg" disabled={pending}>
              Change status <ChevronDown className="size-4" />
            </Button>
          </DropdownTrigger>
          <DropdownContent className="max-h-[70vh] overflow-y-auto">
            {GROUPS.map((g) => (
              <div key={g.label}>
                <DropdownLabel>{g.label}</DropdownLabel>
                {g.statuses.map((s) => (
                  <DropdownItem key={s} disabled={s === job.status} onSelect={() => run(() => setJobStatus(job.id, s))} className={s === job.status ? "font-semibold text-brand-700" : ""}>
                    {STATUS_LABELS[s]}
                    {s === job.status && <span className="ml-auto text-xs">current</span>}
                  </DropdownItem>
                ))}
              </div>
            ))}
          </DropdownContent>
        </Dropdown>
      )}
      <Dropdown>
        <DropdownTrigger asChild>
          <Button size="lg" aria-label="More actions">
            <MoreHorizontal className="size-5" />
          </Button>
        </DropdownTrigger>
        <DropdownContent>
          <DropdownItem onSelect={() => window.open(`/jobs/${number}/ticket`, "_blank")}>
            <Printer className="size-4 text-slate-400" /> Print job ticket
          </DropdownItem>
          {canReorder && job.status !== "completed" && (
            <DropdownItem onSelect={onReorder}>
              <RotateCcw className="size-4 text-slate-400" /> Reorder / duplicate
            </DropdownItem>
          )}
          {canStatus && job.status !== "on_hold" && job.status !== "completed" && job.status !== "cancelled" && (
            <DropdownItem onSelect={() => run(() => setJobStatus(job.id, "on_hold"), { success: "Job put on hold" })}>
              <PauseCircle className="size-4 text-slate-400" /> Put on hold
            </DropdownItem>
          )}
          {canStatus && (job.status === "on_hold" || job.status === "cancelled") && (
            <DropdownItem onSelect={() => run(() => setJobStatus(job.id, "approved"), { success: "Job resumed" })}>
              <PlayCircle className="size-4 text-slate-400" /> Resume job
            </DropdownItem>
          )}
          {canEdit && (
            <>
              <DropdownSeparator />
              {job.status !== "cancelled" && (
                <DropdownItem onSelect={() => setConfirm("cancel")} className="text-red-600">
                  <Ban className="size-4" /> Cancel job
                </DropdownItem>
              )}
              <DropdownItem onSelect={() => setConfirm("archive")} className="text-red-600">
                <Archive className="size-4" /> Archive job
              </DropdownItem>
            </>
          )}
        </DropdownContent>
      </Dropdown>
      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Cancel this job?"
        description="The job stays on file with its history. You can resume it later."
        confirmLabel="Cancel job"
        onConfirm={() => run(() => setJobStatus(job.id, "cancelled"), { success: "Job cancelled" })}
      />
      <ConfirmDialog
        open={confirm === "archive"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Archive this job?"
        description="Archived jobs are hidden from lists and the board but never deleted."
        confirmLabel="Archive"
        onConfirm={() => run(() => archiveJob(job.id), { onSuccess: () => router.push("/jobs") })}
      />
    </div>
  );
}
