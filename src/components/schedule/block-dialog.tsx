"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, Play, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PriorityBadge } from "@/components/status";
import { useJobNo } from "@/components/shop-context";
import { dueLabel, fmtDate } from "@/lib/format";
import { blockIssues } from "@/lib/schedule/logic";
import { MINUTE, durationLabel, fromTimeInput, localParts, rangeLabel, snapNearest, toTimeInput, zonedTime } from "@/lib/schedule/time";
import { BLOCK_STATUS_LABELS, type BoardBlock } from "@/lib/schedule/types";
import { saveScheduleBlock, setScheduleBlockStatus, unscheduleBlock } from "@/app/(app)/schedule/actions";
import { useBoard } from "./board-context";
import { IssueList, LengthFields, MachineHours, MachineSelect, WhenFields } from "./fields";

type Result = { ok: true; data?: unknown; message?: string } | { ok: false; error: string };

/** Show the result of a scheduling action: a short toast, plus warnings when the booking has problems. */
export function toastResult(r: Result, fallback: string, show?: { label: string; onClick: () => void }) {
  if (!r.ok) {
    toast.error(r.error);
    return false;
  }
  const d = (r.data ?? {}) as { summary?: string; warnings?: string[] };
  const action = show ? { action: { label: show.label, onClick: show.onClick } } : {};
  if (d.warnings?.length) toast.warning(d.summary ?? fallback, { description: d.warnings.join(" · "), duration: 10000, ...action });
  else toast.success(d.summary ?? fallback, { ...action, duration: show ? 8000 : undefined });
  return true;
}

export type NewBlockAt = { equipmentId?: number; start?: number };

/**
 * One booking: details, Start / Done, and (for people who schedule) machine, time, length,
 * operator and notes. With `block` null it blocks off machine time (maintenance, service visit).
 */
export function BlockDialog({ block, newAt, onClose }: { block: BoardBlock | null; newAt?: NewBlockAt; onClose: () => void }) {
  const { machines, machineById, users, blocks, canEdit, date } = useBoard();
  const router = useRouter();
  const jobNo = useJobNo();
  const [pending, start] = React.useTransition();
  const initialStart = block?.start ?? newAt?.start ?? zonedTime(date, 9 * 60);
  const p = localParts(initialStart);
  const [equipmentId, setEquipmentId] = React.useState<number | null>(block?.equipmentId ?? newAt?.equipmentId ?? machines[0]?.id ?? null);
  const [ymd, setYmd] = React.useState(p.ymd);
  const [time, setTime] = React.useState(toTimeInput(p.minute));
  const [minutes, setMinutes] = React.useState(block ? Math.round((block.end - block.start) / MINUTE) : 60);
  const [operatorId, setOperatorId] = React.useState<number | null>(block?.operatorId ?? null);
  const [notes, setNotes] = React.useState(block?.notes ?? "");
  const [title, setTitle] = React.useState(block && !block.job ? block.title : "");

  const tMin = fromTimeInput(time);
  const startMs = /^\d{4}-\d{2}-\d{2}$/.test(ymd) && tMin != null ? snapNearest(zonedTime(ymd, tMin)) : NaN;
  const endMs = startMs + minutes * MINUTE;
  const machine = equipmentId ? machineById.get(equipmentId) : undefined;
  const issues =
    Number.isFinite(startMs) && equipmentId
      ? blockIssues({ id: block?.id, equipmentId, start: startMs, end: endMs, dueDate: block?.job?.dueDate ?? null }, machine, blocks)
      : [];

  const run = (fn: () => Promise<Result>, fallback: string) =>
    start(async () => {
      const r = await fn();
      if (toastResult(r, fallback)) {
        onClose();
        router.refresh();
      }
    });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!equipmentId) return toast.error("Pick a machine.");
    if (!Number.isFinite(startMs)) return toast.error("Pick a date and start time.");
    run(
      () => saveScheduleBlock({ id: block?.id ?? null, equipmentId, start: startMs, end: endMs, operatorId, notes: notes || null, title: block?.job ? null : title }),
      block ? "Saved" : "Time blocked off",
    );
  };

  const b = block;
  const heading = b ? (b.job ? `${jobNo(b.job.number)} · ${b.job.title}` : b.title) : "Block off machine time";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        wide
        title={heading}
        description={
          b ? (
            <span>
              {rangeLabel(b.start, b.end)} · {durationLabel((b.end - b.start) / MINUTE)} on {machineById.get(b.equipmentId)?.name ?? "a machine that's turned off"}
            </span>
          ) : (
            "For maintenance, a service visit or anything else that keeps a machine busy."
          )
        }
      >
        {b?.job && (
          <div className="mb-4 space-y-2 rounded-lg bg-slate-50 px-4 py-3 text-[15px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={b.status === "running" ? "amber" : b.status === "done" ? "green" : "blue"}>{BLOCK_STATUS_LABELS[b.status]}</Badge>
              <PriorityBadge priority={b.job.priority} />
              <span className={b.job.dueDate && issues.some((i) => i.kind === "late") ? "font-semibold text-red-600" : "text-slate-600"}>
                Due {dueLabel(b.job.dueDate)}
                {b.job.dueDate ? ` (${fmtDate(b.job.dueDate)})` : ""}
              </span>
              <Link href={`/jobs/${b.job.number}`} className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                Open job <ExternalLink className="size-3.5" />
              </Link>
            </div>
            <p className="text-slate-800">
              <span className="font-medium">{b.job.customer}</span> · {b.title}
              {b.quantity ? ` · qty ${b.quantity.toLocaleString("en-US")}` : ""}
            </p>
            {b.operatorName && <p className="text-sm text-slate-600">Operator: {b.operatorName}</p>}
            {b.notes && !canEdit && <p className="text-sm whitespace-pre-line text-slate-600">{b.notes}</p>}
          </div>
        )}

        {b && canEdit && (
          <div className="mb-5 flex flex-wrap gap-2">
            {b.status === "scheduled" && (
              <Button variant="primary" size="lg" disabled={pending} onClick={() => run(() => setScheduleBlockStatus(b.id, "running"), "Started")}>
                <Play className="size-5" /> Start
              </Button>
            )}
            {b.status !== "done" && (
              <Button variant="success" size="lg" disabled={pending} onClick={() => run(() => setScheduleBlockStatus(b.id, "done"), "Done")}>
                <CheckCircle2 className="size-5" /> Done
              </Button>
            )}
            {b.status !== "scheduled" && (
              <Button size="lg" disabled={pending} onClick={() => run(() => setScheduleBlockStatus(b.id, "scheduled"), "Back to scheduled")}>
                <RotateCcw className="size-4" /> Back to scheduled
              </Button>
            )}
          </div>
        )}

        {canEdit ? (
          <form onSubmit={save} className="space-y-4">
            {!b?.job && (
              <Field label="What is it for?" htmlFor="bd-title" required>
                <Input id="bd-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Maintenance, service visit, training…" required maxLength={200} />
              </Field>
            )}
            <Field label="Machine" htmlFor="bd-machine">
              <MachineSelect id="bd-machine" machines={machines} value={equipmentId} onChange={setEquipmentId} />
              <MachineHours machine={machine} />
            </Field>
            <WhenFields idPrefix="bd" ymd={ymd} time={time} onYmd={setYmd} onTime={setTime} />
            <Field label="Length" htmlFor="bd-len-h" hint={Number.isFinite(startMs) ? `${rangeLabel(startMs, endMs)}` : undefined}>
              <LengthFields idPrefix="bd-len" minutes={minutes} onChange={setMinutes} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Operator" htmlFor="bd-op">
                <Select id="bd-op" value={operatorId ?? ""} onChange={(e) => setOperatorId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">No one yet</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Notes" htmlFor="bd-notes">
              <Textarea id="bd-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Paper is on the cart, run the proof sheet first…" />
            </Field>
            <IssueList issues={issues} okText={Number.isFinite(startMs) ? "Fits: no clashes, within working hours." : undefined} />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {b && (
                <Confirm
                  title="Take this off the schedule?"
                  description={b.job ? "The work goes back to “Waiting to be scheduled”. The job's history keeps a note of it." : "The machine time is freed up."}
                  confirmLabel="Take it off"
                  onConfirm={() => run(() => unscheduleBlock(b.id), "Taken off the schedule")}
                >
                  <Button variant="ghost" className="text-red-600 hover:bg-red-50">
                    <Trash2 className="size-4" /> Unschedule
                  </Button>
                </Confirm>
              )}
              <div className="ml-auto flex gap-2">
                <Button onClick={onClose}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={pending}>
                  {pending ? "Saving…" : b ? "Save" : "Block off time"}
                </Button>
              </div>
            </div>
          </form>
        ) : (
          <div className="flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
