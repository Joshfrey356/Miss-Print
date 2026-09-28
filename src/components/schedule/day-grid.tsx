"use client";
import * as React from "react";
import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { capacityMinutes, dayLoad, isWorkDay, workMinutes, workWindow } from "@/lib/schedule/logic";
import { MINUTE, dayBounds, hourLabel, hoursLabel, localParts, rangeLabel, snapNearest, zonedTime } from "@/lib/schedule/time";
import { MACHINE_KIND_SHORT, type BoardBlock, type BoardMachine } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";
import { useBoard } from "./board-context";
import { TimelineBlock } from "./block-view";

const LABEL_W = 208;
const MIN_PPM = 1.35; // px per minute (81 px an hour)
const LANE_H = 60;

/** Put overlapping bookings in separate lanes so both stay visible. */
function lanes(blocks: BoardBlock[]): Map<number, number> {
  const ends: number[] = [];
  const out = new Map<number, number>();
  for (const b of [...blocks].sort((x, y) => x.start - y.start || x.id - y.id)) {
    let i = ends.findIndex((e) => e <= b.start);
    if (i < 0) {
      i = ends.length;
      ends.push(b.end);
    } else ends[i] = b.end;
    out.set(b.id, i);
  }
  return out;
}

export function LoadBar({ booked, capacity, className }: { booked: number; capacity: number; className?: string }) {
  const over = booked > capacity;
  const pctW = capacity > 0 ? Math.min(100, (booked / capacity) * 100) : booked > 0 ? 100 : 0;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-slate-200", className)} aria-hidden>
      <div className={cn("h-full rounded-full", over ? "bg-red-500" : pctW >= 85 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${pctW}%` }} />
    </div>
  );
}

export function DayGrid() {
  const { date, machines, blocks, now, geometry, preview, canEdit, newBlock } = useBoard();
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(1100);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Hours shown: 7 am – 7 pm, widened to fit working hours and bookings that day.
  const day = dayBounds(date);
  let from = 7 * 60;
  let to = 19 * 60;
  for (const m of machines) {
    const w = workMinutes(m);
    if (w && isWorkDay(m, date)) {
      from = Math.min(from, Math.floor(w.from / 60) * 60);
      to = Math.max(to, Math.ceil(w.to / 60) * 60);
    }
  }
  const todays = blocks.filter((b) => b.start < day.end && b.end > day.start);
  for (const b of todays) {
    from = Math.min(from, b.start <= day.start ? 0 : Math.floor(localParts(b.start).minute / 60) * 60);
    to = Math.max(to, b.end >= day.end ? 1440 : Math.ceil(localParts(b.end).minute / 60) * 60 || 1440);
  }
  const viewStart = zonedTime(date, from);
  const viewEnd = zonedTime(date, to);
  const total = (viewEnd - viewStart) / MINUTE;
  const ppm = Math.max(MIN_PPM, (width - LABEL_W - 2) / total);
  geometry.current = { viewStart, ppm };
  const x = (ms: number) => ((Math.min(Math.max(ms, viewStart), viewEnd) - viewStart) / MINUTE) * ppm;
  const hours: number[] = [];
  for (let t = zonedTime(date, from); t < viewEnd; t += 60 * MINUTE) hours.push(t);
  const showNow = now >= viewStart && now <= viewEnd;

  // Start scrolled to the working day (or to now, when it's later in the day).
  const firstWork = Math.min(...machines.map((m) => workWindow(m, date)?.start ?? Infinity));
  const scrollTo = showNow && now - 2 * 60 * MINUTE > firstWork ? now - 2 * 60 * MINUTE : Number.isFinite(firstWork) ? firstWork - 30 * MINUTE : viewStart;
  const scrollX = Math.max(0, x(scrollTo));
  React.useEffect(() => {
    if (ref.current) ref.current.scrollLeft = scrollX;
    // Only when the day changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return (
    <div ref={ref} className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <div style={{ width: LABEL_W + total * ppm }} className="relative">
        {/* Hour header */}
        <div className="sticky top-0 z-20 flex border-b border-slate-200 bg-slate-50/95">
          <div style={{ width: LABEL_W }} className="sticky left-0 z-10 shrink-0 border-r border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Machine
          </div>
          <div className="relative h-9" style={{ width: total * ppm }}>
            {hours.map((t) => (
              <span key={t} className="absolute top-2 -translate-x-1/2 text-xs whitespace-nowrap text-slate-500 tabular-nums first:translate-x-1" style={{ left: x(t) }}>
                {hourLabel(localParts(t).minute)}
              </span>
            ))}
            {showNow && <span className="absolute bottom-0 size-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-red-500" style={{ left: x(now) }} />}
          </div>
        </div>

        {machines.map((m) => (
          <MachineRow key={m.id} machine={m} blocks={todays.filter((b) => b.equipmentId === m.id)} x={x} ppm={ppm} total={total} hours={hours} viewStart={viewStart} viewEnd={viewEnd} showNow={showNow} />
        ))}
        {preview && !preview.ymd && <span className="sr-only" aria-live="polite">{rangeLabel(preview.start, preview.end)}</span>}
      </div>
      {canEdit && (
        <div className="sticky left-0 flex items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm text-slate-500" style={{ width: Math.min(width, LABEL_W + total * ppm) }}>
          <span className="hidden sm:inline">Drag a booking to move it, drag its right edge to change the length, or click it to edit.</span>
          <button type="button" onClick={() => newBlock()} className="ml-auto inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
            <Plus className="size-4" /> Block off time
          </button>
        </div>
      )}
    </div>
  );
}

function MachineRow({
  machine: m,
  blocks,
  x,
  ppm,
  total,
  hours,
  viewStart,
  viewEnd,
  showNow,
}: {
  machine: BoardMachine;
  blocks: BoardBlock[];
  x: (ms: number) => number;
  ppm: number;
  total: number;
  hours: number[];
  viewStart: number;
  viewEnd: number;
  showNow: boolean;
}) {
  const { date, now, preview, blocks: all, resizeBlock, canEdit, newBlock } = useBoard();
  const { setNodeRef, isOver } = useDroppable({ id: `m:${m.id}`, data: { equipmentId: m.id } });
  const [resizing, setResizing] = React.useState<{ id: number; end: number } | null>(null);
  const lane = lanes(blocks);
  const laneCount = Math.max(1, ...[...lane.values()].map((l) => l + 1));
  const height = laneCount * LANE_H + 8;
  const w = workWindow(m, date);
  const load = dayLoad(m, all, date);
  const cap = capacityMinutes(m, date);

  const startResize = (b: BoardBlock) => (e: React.PointerEvent) => {
    const x0 = e.clientX;
    let end = b.end;
    setResizing({ id: b.id, end });
    const move = (ev: PointerEvent) => {
      end = Math.max(b.start + 15 * MINUTE, snapNearest(b.end + ((ev.clientX - x0) / ppm) * MINUTE));
      setResizing({ id: b.id, end });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setResizing(null);
      if (end !== b.end) resizeBlock(b, end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="flex border-b border-slate-100 last:border-b-0">
      <div style={{ width: LABEL_W }} className="sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1 border-r border-slate-200 bg-white px-3 py-2">
        <p className="truncate text-[15px] leading-tight font-semibold text-slate-900" title={m.name}>
          {m.name}
        </p>
        <p className="text-xs text-slate-500">
          {MACHINE_KIND_SHORT[m.kind]} ·{" "}
          {cap ? (
            <span className={cn("tabular-nums", load.booked > cap && "font-semibold text-red-600")}>
              {hoursLabel(load.booked)} of {hoursLabel(cap)} hr
            </span>
          ) : (
            <span className={cn(load.booked > 0 && "font-semibold text-red-600")}>Off today</span>
          )}
        </p>
        {cap > 0 && <LoadBar booked={load.booked} capacity={cap} />}
      </div>
      <div
        ref={setNodeRef}
        data-timeline={m.id}
        className={cn("relative shrink-0", isOver && "bg-brand-50/60")}
        style={{ width: total * ppm, height }}
        onDoubleClick={(e) => {
          if (!canEdit || e.target !== e.currentTarget) return;
          const rect = e.currentTarget.getBoundingClientRect();
          newBlock({ equipmentId: m.id, start: snapNearest(viewStart + ((e.clientX - rect.left) / ppm) * MINUTE) });
        }}
      >
        {/* Outside working hours: shaded */}
        {w ? (
          <>
            {w.start > viewStart && <div className="pointer-events-none absolute inset-y-0 left-0 bg-slate-100/80" style={{ width: x(w.start) }} />}
            {w.end < viewEnd && <div className="pointer-events-none absolute inset-y-0 right-0 bg-slate-100/80" style={{ left: x(w.end) }} />}
          </>
        ) : (
          <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(135deg,#f8fafc_0,#f8fafc_8px,#f1f5f9_8px,#f1f5f9_16px)]" />
        )}
        {hours.map((t) => (
          <div key={t} className="pointer-events-none absolute inset-y-0 border-l border-slate-100" style={{ left: x(t) }} />
        ))}
        {showNow && <div className="pointer-events-none absolute inset-y-0 z-[5] w-0.5 -translate-x-1/2 bg-red-500/80" style={{ left: x(now) }} />}
        {blocks.map((b) => {
          const end = resizing?.id === b.id ? resizing.end : b.end;
          const left = x(b.start);
          const width = Math.max(14, x(end) - left - 2);
          return (
            <TimelineBlock
              key={b.id}
              b={b}
              style={{ left: left + 1, width, top: 4 + (lane.get(b.id) ?? 0) * LANE_H, height: LANE_H - 6 }}
              onResizeStart={startResize(b)}
            />
          );
        })}
        {resizing && (
          <span className="pointer-events-none absolute -top-0.5 z-30 rounded bg-slate-900 px-1.5 py-0.5 text-xs text-white" style={{ left: x(resizing.end) }}>
            {rangeLabel(blocks.find((b) => b.id === resizing.id)?.start ?? resizing.end, resizing.end).replace(/^\w{3} /, "")}
          </span>
        )}
        {preview && !preview.ymd && preview.equipmentId === m.id && (
          <div
            className="pointer-events-none absolute z-20 rounded-lg border-2 border-dashed border-brand-500 bg-brand-100/50"
            style={{ left: x(preview.start), width: Math.max(14, x(preview.end) - x(preview.start)), top: 2, bottom: 2 }}
          >
            <span className="absolute -top-6 left-0 rounded bg-brand-700 px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-white shadow">{rangeLabel(preview.start, preview.end)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
