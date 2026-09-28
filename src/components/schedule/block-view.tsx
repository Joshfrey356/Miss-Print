"use client";
import * as React from "react";
import { useDraggable } from "@dnd-kit/core";
import { AlertTriangle, Check, Play, Wrench } from "lucide-react";
import { useJobNo } from "@/components/shop-context";
import { dueLabel } from "@/lib/format";
import type { Issue } from "@/lib/schedule/logic";
import { durationLabel, rangeLabel } from "@/lib/schedule/time";
import type { BoardBlock } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";
import { useBoard, type DragData } from "./board-context";

/** Colors by status: scheduled = blue, running = amber, done = gray-green; blocked-off time = striped gray. */
export function blockClasses(b: BoardBlock, issues: Issue[], highlight: boolean) {
  const late = issues.some((i) => i.kind === "late");
  return cn(
    "rounded-lg border text-left shadow-sm transition-shadow",
    !b.job
      ? "border-slate-300 bg-[repeating-linear-gradient(135deg,#f1f5f9_0,#f1f5f9_6px,#e2e8f0_6px,#e2e8f0_12px)] text-slate-700"
      : b.status === "running"
        ? "border-amber-400 bg-amber-50 text-amber-950"
        : b.status === "done"
          ? "border-emerald-200 bg-emerald-50/70 text-slate-500"
          : "border-brand-300 bg-brand-50 text-brand-950",
    late && b.status !== "done" && "outline-2 outline-offset-[-1px] outline-red-500",
    highlight && "ring-2 ring-violet-500 ring-offset-1",
  );
}

export function blockStripe(b: BoardBlock) {
  return !b.job ? "bg-slate-400" : b.status === "running" ? "bg-amber-500" : b.status === "done" ? "bg-emerald-500" : "bg-brand-500";
}

/** "Print · 500" — the step and quantity. */
export function stepText(b: BoardBlock) {
  const step = b.title.split(" · ")[0] ?? b.title;
  if (!b.job || !b.quantity) return step;
  const qty = b.quantity.toLocaleString("en-US");
  // "500 Business Cards" already says how many.
  return new RegExp(`(^|\\D)${qty.replace(/,/g, ",?")}(\\D|$)`).test(b.job.title) ? step : `${step} · ${qty}`;
}

export function tooltipText(b: BoardBlock, jobNo: (n: number) => string, issues: Issue[]) {
  const lines = [
    b.job ? `${jobNo(b.job.number)} · ${b.job.customer}` : "Blocked off",
    b.job ? b.job.title : "",
    b.title,
    `${rangeLabel(b.start, b.end)} (${durationLabel((b.end - b.start) / 60000)})`,
    b.job ? `Due ${dueLabel(b.job.dueDate)}` : "",
    b.operatorName ? `Operator: ${b.operatorName}` : "",
    ...issues.map((i) => `⚠ ${i.text}`),
  ];
  return lines.filter(Boolean).join("\n");
}

function StatusIcon({ b }: { b: BoardBlock }) {
  if (!b.job) return <Wrench className="size-3.5 shrink-0 text-slate-500" />;
  if (b.status === "running")
    return (
      <span className="relative flex size-2.5 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
      </span>
    );
  if (b.status === "done") return <Check className="size-3.5 shrink-0 text-emerald-600" />;
  return null;
}

/** A booking on the day timeline (absolutely positioned by the row). */
export function TimelineBlock({
  b,
  style,
  dragging,
  onResizeStart,
}: {
  b: BoardBlock;
  style: React.CSSProperties;
  dragging?: boolean;
  /** Day view: drag the right edge to change the length. */
  onResizeStart?: (e: React.PointerEvent) => void;
}) {
  const { canEdit, openBlock, issuesOf, highlightJobId } = useBoard();
  const jobNo = useJobNo();
  const issues = issuesOf(b);
  const data: DragData = { type: "block", block: b };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `b:${b.id}`, data, disabled: !canEdit });
  const warn = issues.some((i) => i.kind !== "late");
  const wide = typeof style.width === "number" ? style.width : 999;
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(canEdit ? { ...attributes, ...listeners } : {})}
      onClick={() => openBlock(b)}
      title={tooltipText(b, jobNo, issues)}
      aria-label={`${b.job ? jobNo(b.job.number) : "Blocked off"} ${b.title}, ${rangeLabel(b.start, b.end)}. Open to edit.`}
      style={style}
      className={cn(
        "absolute overflow-hidden",
        blockClasses(b, issues, !!highlightJobId && b.job?.id === highlightJobId),
        canEdit ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer",
        (isDragging || dragging) && "opacity-40",
        "focus-visible:outline-2 focus-visible:outline-brand-600",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", blockStripe(b))} />
      <span className="flex h-full flex-col justify-center gap-0.5 py-1 pr-1.5 pl-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-tight font-semibold">
          <StatusIcon b={b} />
          <span className="truncate">{b.job ? jobNo(b.job.number) : b.title}</span>
          {wide > 110 && b.job && <span className="truncate font-normal opacity-80">{b.job.customer}</span>}
          {warn && <AlertTriangle className="ml-auto size-3.5 shrink-0 text-amber-600" aria-label="Has warnings" />}
        </span>
        {wide > 60 && (
          <span className="truncate text-xs leading-tight opacity-90">
            {b.job ? `${stepText(b)} · ${b.job.title}` : b.operatorName ?? rangeLabel(b.start, b.end)}
          </span>
        )}
        {wide > 90 && b.job && (
          <span className="truncate text-[11px] leading-tight opacity-75">
            {rangeLabel(b.start, b.end)} · Due {dueLabel(b.job.dueDate)}
          </span>
        )}
      </span>
      {canEdit && onResizeStart && (
        <span
          role="presentation"
          title="Drag to change the length"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResizeStart(e);
          }}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize touch-none rounded-r-lg hover:bg-black/10"
        />
      )}
    </button>
  );
}

/** A booking in a week cell: compact line. */
export function ChipBlock({ b }: { b: BoardBlock }) {
  const { canEdit, openBlock, issuesOf, highlightJobId } = useBoard();
  const jobNo = useJobNo();
  const issues = issuesOf(b);
  const data: DragData = { type: "block", block: b };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `b:${b.id}`, data, disabled: !canEdit });
  const warn = issues.some((i) => i.kind !== "late");
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(canEdit ? { ...attributes, ...listeners } : {})}
      onClick={() => openBlock(b)}
      title={tooltipText(b, jobNo, issues)}
      className={cn(
        "relative block w-full overflow-hidden py-1 pr-1.5 pl-2.5 text-xs",
        blockClasses(b, issues, !!highlightJobId && b.job?.id === highlightJobId),
        canEdit ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer",
        isDragging && "opacity-40",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", blockStripe(b))} />
      <span className="flex items-center gap-1 font-semibold">
        <StatusIcon b={b} />
        <span className="truncate">{b.job ? jobNo(b.job.number) : b.title}</span>
        {warn && <AlertTriangle className="ml-auto size-3 shrink-0 text-amber-600" />}
      </span>
      <span className="block truncate opacity-80">
        {rangeLabel(b.start, b.end).replace(/^\w{3} /, "")}
        {b.job ? ` · ${stepText(b)}` : ""}
      </span>
    </button>
  );
}

/** What follows the pointer while dragging. */
export function DragPreviewCard({ data, width }: { data: DragData; width?: number }) {
  const jobNo = useJobNo();
  if (data.type === "block") {
    const b = data.block;
    return (
      <div style={{ width: width ?? 180 }} className={cn("relative h-14 overflow-hidden py-1 pr-1.5 pl-2.5 shadow-lg", blockClasses(b, [], false))}>
        <span className={cn("absolute inset-y-0 left-0 w-1", blockStripe(b))} />
        <p className="truncate text-[13px] font-semibold">{b.job ? `${jobNo(b.job.number)} · ${b.job.customer}` : b.title}</p>
        <p className="truncate text-xs">{b.job ? stepText(b) : ""}</p>
      </div>
    );
  }
  const p = data.piece;
  return (
    <div className="w-56 rounded-lg border border-brand-400 bg-white px-3 py-2 text-sm shadow-xl">
      <p className="truncate font-semibold text-slate-900">
        {jobNo(data.job.number)} · {p.label}
      </p>
      <p className="truncate text-xs text-slate-500">
        {durationLabel(p.minutes)} · {data.job.customer}
      </p>
    </div>
  );
}
