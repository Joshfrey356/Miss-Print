"use client";
import { StatusControls } from "./status-controls";
import { ReorderDialog, useReorderParam } from "./reorder-dialog";
import type { WorkflowJob } from "@/lib/jobs/workflow";

export function HeaderActions({
  job,
  reorder,
  canStatus,
  canEdit,
  canReorder,
  canSeeMoney,
}: {
  job: WorkflowJob & { id: number; number: number };
  reorder: { title: string; quantity: number; priceCents: number; itemCount: number; completedAt: Date | null };
  canStatus: boolean;
  canEdit: boolean;
  canReorder: boolean;
  canSeeMoney: boolean;
}) {
  const [open, setOpen] = useReorderParam();
  return (
    <>
      <StatusControls job={job} number={job.number} canStatus={canStatus} canEdit={canEdit} canReorder={canReorder} onReorder={() => setOpen(true)} />
      {canReorder && <ReorderDialog open={open} onOpenChange={setOpen} canSeeMoney={canSeeMoney} job={{ id: job.id, number: job.number, ...reorder }} />}
    </>
  );
}
