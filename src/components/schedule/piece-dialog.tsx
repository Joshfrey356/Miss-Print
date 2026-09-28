"use client";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/input";
import { useJobNo } from "@/components/shop-context";
import { dueLabel } from "@/lib/format";
import { blockIssues, firstFreeSlot } from "@/lib/schedule/logic";
import { MINUTE, fromTimeInput, localParts, rangeLabel, snapNearest, toTimeInput, zonedTime } from "@/lib/schedule/time";
import type { BoardPiece, WaitingJob } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";
import { useBoard } from "./board-context";
import { IssueList, LengthFields, MachineHours, MachineSelect, WhenFields } from "./fields";

/** Schedule one piece of waiting work with a chosen machine, time and length (the keyboard/touch way). */
export function PieceDialog({ job, piece, onClose }: { job: WaitingJob; piece: BoardPiece; onClose: () => void }) {
  const { machines, machineById, busy: allBusy, schedulePiece, now, pending } = useBoard();
  const jobNo = useJobNo();
  const [equipmentId, setEquipmentId] = React.useState<number | null>(piece.equipmentId);
  const [minutes, setMinutes] = React.useState(piece.minutes);
  const [mode, setMode] = React.useState<"first" | "pick">("first");
  const machine = equipmentId ? machineById.get(equipmentId) : undefined;
  // Suggest the first free time; it's also where "pick a time" starts.
  const busy = React.useMemo(() => allBusy.filter((b) => b.equipmentId === equipmentId), [allBusy, equipmentId]);
  const suggestion = machine ? firstFreeSlot(machine, busy, minutes, now) : null;
  const firstStart = suggestion?.[0]?.start ?? snapNearest(now);
  const [ymd, setYmd] = React.useState(localParts(firstStart).ymd);
  const [time, setTime] = React.useState(toTimeInput(localParts(firstStart).minute));
  const tMin = fromTimeInput(time);
  const picked = /^\d{4}-\d{2}-\d{2}$/.test(ymd) && tMin != null ? snapNearest(zonedTime(ymd, tMin)) : NaN;
  const issues =
    mode === "pick" && Number.isFinite(picked) && equipmentId
      ? blockIssues({ equipmentId, start: picked, end: picked + minutes * MINUTE, dueDate: job.dueDate }, machine, allBusy)
      : suggestion && equipmentId
        ? suggestion.flatMap((s) => blockIssues({ equipmentId, start: s.start, end: s.end, dueDate: job.dueDate }, machine, allBusy))
        : [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!equipmentId) return toast.error("Pick a machine.");
    if (mode === "pick" && !Number.isFinite(picked)) return toast.error("Pick a date and start time.");
    schedulePiece(job, piece, { equipmentId, minutes, start: mode === "pick" ? picked : undefined });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Schedule ${piece.label.toLowerCase()} · ${jobNo(job.number)}`} description={`${job.customer} · ${piece.itemDescription} · due ${dueLabel(job.dueDate)}`}>
        <form onSubmit={submit} className="space-y-4">
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{piece.detail}</p>
          <Field label="Machine" htmlFor="pd-machine">
            <MachineSelect id="pd-machine" machines={machines} value={equipmentId} onChange={setEquipmentId} />
            <MachineHours machine={machine} />
          </Field>
          <Field label="Length" htmlFor="pd-len-h">
            <LengthFields idPrefix="pd-len" minutes={minutes} onChange={setMinutes} />
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-700">When</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["first", "pick"] as const).map((k) => (
                <label key={k} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-[15px]", mode === k ? "border-brand-500 bg-brand-50" : "border-slate-300")}>
                  <input type="radio" name="pd-mode" checked={mode === k} onChange={() => setMode(k)} className="mt-1 accent-brand-500" />
                  <span>
                    {k === "first" ? "First free time" : "Pick a time"}
                    {k === "first" && (
                      <span className="block text-xs text-slate-500">{suggestion ? suggestion.map((s) => rangeLabel(s.start, s.end)).join(", ") : "No free time in the next 60 days"}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {mode === "pick" && <WhenFields idPrefix="pd" ymd={ymd} time={time} onYmd={setYmd} onTime={setTime} />}
          <IssueList issues={issues} okText="Fits: no clashes, within working hours, before the due date." />
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending || !equipmentId}>
              Schedule
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
