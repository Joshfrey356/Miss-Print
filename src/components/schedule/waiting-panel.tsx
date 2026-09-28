"use client";
import * as React from "react";
import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { CalendarCheck2, GripVertical, SlidersHorizontal, Sparkles } from "lucide-react";
import { PriorityBadge } from "@/components/status";
import { useJobNo } from "@/components/shop-context";
import { Button } from "@/components/ui/button";
import { dueLabel, today } from "@/lib/format";
import { durationLabel } from "@/lib/schedule/time";
import type { BoardPiece, WaitingJob } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";
import { pieceId, useBoard, type DragData } from "./board-context";

export function WaitingPanel({ onAutoSchedule }: { onAutoSchedule: () => void }) {
  const { waiting, hiddenPieces, highlightJobId, canEdit } = useBoard();
  const jobs = waiting
    .map((j) => ({ ...j, pieces: j.pieces.filter((p) => !hiddenPieces.has(pieceId(j.id, p.key))) }))
    .filter((j) => j.pieces.length)
    .sort((a, b) => (a.id === highlightJobId ? -1 : b.id === highlightJobId ? 1 : 0));
  const count = jobs.reduce((s, j) => s + j.pieces.length, 0);
  return (
    <section aria-labelledby="waiting-h" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 id="waiting-h" className="text-base font-semibold text-slate-900">
            Waiting to be scheduled
          </h2>
          <p className="text-sm text-slate-500">{count ? `${count} ${count === 1 ? "piece" : "pieces"} of work on ${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}` : "Approved and in-production jobs"}</p>
        </div>
      </div>
      {canEdit && count > 1 && (
        <div className="border-b border-slate-100 px-4 py-2.5 sm:hidden">
          <Button size="sm" className="w-full" onClick={onAutoSchedule}>
            <Sparkles className="size-4 text-brand-600" /> Auto-schedule all waiting
          </Button>
        </div>
      )}
      {jobs.length === 0 ? (
        <div className="flex flex-col items-center px-4 py-8 text-center">
          <div className="mb-2 rounded-full bg-emerald-50 p-2.5 text-emerald-600">
            <CalendarCheck2 className="size-5" />
          </div>
          <p className="text-[15px] font-medium text-slate-700">Everything is on the schedule</p>
          <p className="mt-1 text-sm text-slate-500">Jobs show up here when they&apos;re approved for production.</p>
        </div>
      ) : (
        <ul className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-3 2xl:max-h-[calc(100vh-16rem)] 2xl:grid-cols-1 2xl:overflow-y-auto">
          {jobs.map((j) => (
            <WaitingJobCard key={j.id} job={j} />
          ))}
        </ul>
      )}
    </section>
  );
}

function WaitingJobCard({ job }: { job: WaitingJob }) {
  const { highlightJobId } = useBoard();
  const jobNo = useJobNo();
  const late = !!job.dueDate && job.dueDate < today();
  const ref = React.useRef<HTMLLIElement>(null);
  const highlighted = job.id === highlightJobId;
  React.useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);
  return (
    <li ref={ref} className={cn("bg-white px-4 py-3", highlighted && "bg-violet-50 ring-2 ring-violet-400 ring-inset")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link href={`/jobs/${job.number}`} className="font-semibold text-brand-700 hover:underline">
          {jobNo(job.number)}
        </Link>
        <PriorityBadge priority={job.priority} />
        <span className={cn("ml-auto text-sm", late ? "font-semibold text-red-600" : "text-slate-500")}>Due {dueLabel(job.dueDate)}</span>
      </div>
      <p className="truncate text-sm text-slate-700" title={`${job.customer} · ${job.title}`}>
        <span className="font-medium">{job.customer}</span> · {job.title}
      </p>
      <ul className="mt-2 space-y-1.5">
        {job.pieces.map((p) => (
          <PieceRow key={p.key} job={job} piece={p} showItem={new Set(job.pieces.map((x) => x.jobItemId)).size > 1} />
        ))}
      </ul>
    </li>
  );
}

function PieceRow({ job, piece, showItem }: { job: WaitingJob; piece: BoardPiece; showItem: boolean }) {
  const { canEdit, machineById, schedulePiece, openPiece, pending } = useBoard();
  const data: DragData = { type: "piece", piece, job };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `p:${pieceId(job.id, piece.key)}`, data, disabled: !canEdit });
  const machine = piece.equipmentId ? machineById.get(piece.equipmentId) : undefined;
  return (
    <li ref={setNodeRef} className={cn("flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/60 py-1.5 pr-1.5 pl-1", isDragging && "opacity-40")}>
      {canEdit && (
        <button type="button" {...attributes} {...listeners} aria-label={`Drag ${piece.label} onto the board`} className="cursor-grab touch-none rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 active:cursor-grabbing">
          <GripVertical className="size-4" />
        </button>
      )}
      <div className="min-w-0 flex-1" title={`${piece.itemDescription}\n${piece.detail}`}>
        <p className="truncate text-sm font-medium text-slate-800">
          {piece.label} · {durationLabel(piece.minutes)}
          {piece.source === "guess" && <span className="font-normal text-amber-700"> (guess)</span>}
        </p>
        <p className="truncate text-xs text-slate-500">{machine ? machine.name : "Pick a machine"}</p>
        {showItem && <p className="truncate text-xs text-slate-500">{piece.itemDescription}</p>}
      </div>
      {canEdit && (
        <>
          <button type="button" onClick={() => openPiece(job, piece)} aria-label={`Choose machine, time and length for ${piece.label}`} title="Choose machine, time and length" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800">
            <SlidersHorizontal className="size-4" />
          </button>
          <Button size="sm" variant="primary" disabled={pending || !machine} onClick={() => schedulePiece(job, piece)} title="Put it in the first free time on the machine">
            Schedule
          </Button>
        </>
      )}
    </li>
  );
}
