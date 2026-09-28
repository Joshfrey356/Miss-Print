"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, pointerWithin, rectIntersection, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from "@dnd-kit/core";
import { blockIssues, firstFreeSlot, workWindow, type BusyBlock } from "@/lib/schedule/logic";
import { MINUTE, dayBounds, localParts, snapNearest, ymdAt, zonedTime } from "@/lib/schedule/time";
import type { BoardBlock, BoardMachine, BoardPiece, ScheduleView, WaitingJob } from "@/lib/schedule/types";
import { moveScheduleBlock, scheduleWork } from "@/app/(app)/schedule/actions";
import { AutoScheduleDialog } from "./auto-dialog";
import { BlockDialog, toastResult, type NewBlockAt } from "./block-dialog";
import { BoardProvider, pieceId, useIssues, type BoardCtx, type DragData, type DropPreview, type Person } from "./board-context";
import { DragPreviewCard } from "./block-view";
import { DayGrid } from "./day-grid";
import { PhoneList } from "./phone-list";
import { PieceDialog } from "./piece-dialog";
import { WaitingPanel } from "./waiting-panel";
import { WeekGrid } from "./week-grid";

type Dialog =
  | { kind: "block"; block: BoardBlock }
  | { kind: "new"; at?: NewBlockAt }
  | { kind: "piece"; job: WaitingJob; piece: BoardPiece }
  | { kind: "auto" }
  | null;

export type ScheduleBoardProps = {
  view: ScheduleView;
  date: string;
  days: string[];
  machines: BoardMachine[];
  blocks: BoardBlock[];
  busy: BusyBlock[];
  waiting: WaitingJob[];
  users: Person[];
  canEdit: boolean;
  highlightJobId: number | null;
  now: number;
};

const pointerX = (e: Event | null): number | null => {
  if (!e) return null;
  if ("clientX" in e && typeof (e as PointerEvent).clientX === "number") return (e as PointerEvent).clientX;
  const t = (e as TouchEvent).touches?.[0] ?? (e as TouchEvent).changedTouches?.[0];
  return t ? t.clientX : null;
};

/** The row / day cell under the pointer (not the one the dragged card overlaps most). */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

/** Open the "Auto-schedule all waiting" preview from outside the board (the page toolbar). */
export const AUTO_EVENT = "schedule:auto";
export const NEW_BLOCK_EVENT = "schedule:new-block";

export function ScheduleBoard(p: ScheduleBoardProps) {
  const router = useRouter();
  const [blocks, setBlocks] = React.useState(p.blocks);
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const [prev, setPrev] = React.useState({ blocks: p.blocks, waiting: p.waiting });
  if (prev.blocks !== p.blocks || prev.waiting !== p.waiting) {
    setPrev({ blocks: p.blocks, waiting: p.waiting });
    setBlocks(p.blocks);
    setHidden(new Set());
  }
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [preview, setPreview] = React.useState<DropPreview>(null);
  const [active, setActive] = React.useState<DragData | null>(null);
  const [now, setNow] = React.useState(p.now);
  const [pending, startTransition] = React.useTransition();
  const geometry = React.useRef({ viewStart: 0, ppm: 1 });
  const dndId = React.useId();

  const pointer = React.useRef<{ x: number; y: number } | null>(null);
  React.useEffect(() => {
    const track = (e: PointerEvent | TouchEvent) => {
      const t = "touches" in e ? e.touches[0] : e;
      if (t) pointer.current = { x: t.clientX, y: t.clientY };
    };
    window.addEventListener("pointermove", track, { passive: true });
    window.addEventListener("touchmove", track, { passive: true });
    return () => {
      window.removeEventListener("pointermove", track);
      window.removeEventListener("touchmove", track);
    };
  }, []);

  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    const onAuto = () => setDialog({ kind: "auto" });
    const onNew = () => setDialog({ kind: "new" });
    window.addEventListener(AUTO_EVENT, onAuto);
    window.addEventListener(NEW_BLOCK_EVENT, onNew);
    return () => {
      clearInterval(t);
      window.removeEventListener(AUTO_EVENT, onAuto);
      window.removeEventListener(NEW_BLOCK_EVENT, onNew);
    };
  }, []);

  const machineById = React.useMemo(() => new Map(p.machines.map((m) => [m.id, m])), [p.machines]);
  const issues = useIssues(blocks, machineById);
  // Everything known: bookings shown plus the future ones (for free-time suggestions).
  const busy = React.useMemo(() => {
    const shown = new Set(blocks.map((b) => b.id));
    return [...blocks, ...p.busy.filter((b) => b.id == null || !shown.has(b.id))];
  }, [blocks, p.busy]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }));

  /** Where the dragged thing would land. */
  const target = (e: DragMoveEvent | DragEndEvent): DropPreview => {
    const over = e.over;
    const data = e.active.data.current as DragData | undefined;
    if (!over || !data) return null;
    const drop = over.data.current as { equipmentId: number; ymd?: string };
    const machine = machineById.get(drop.equipmentId);
    if (!machine) return null;
    const minutes = data.type === "block" ? (data.block.end - data.block.start) / MINUTE : data.piece.minutes;
    if (!drop.ymd) {
      const { viewStart, ppm } = geometry.current;
      // Measure the row now: it may have scrolled sideways since the drag started.
      const rowLeft = document.querySelector(`[data-timeline="${machine.id}"]`)?.getBoundingClientRect().left ?? over.rect.left;
      // Where the pointer is now (dnd-kit's delta also counts the board's sideways scroll).
      const px = pointer.current?.x ?? (pointerX(e.activatorEvent) ?? 0) + e.delta.x;
      let x: number;
      if (data.type === "block") {
        // Keep the spot where the block was grabbed under the pointer.
        const grabbed = (pointerX(e.activatorEvent) ?? px) - (e.active.rect.current.initial?.left ?? 0);
        x = px - grabbed - rowLeft;
      } else x = px - rowLeft;
      const start = snapNearest(viewStart + (x / ppm) * MINUTE);
      return { equipmentId: machine.id, start, end: start + minutes * MINUTE };
    }
    // Week view: a booking keeps its time of day; new work goes into the first free time that day.
    if (data.type === "block") {
      const start = zonedTime(drop.ymd, localParts(data.block.start).minute);
      return { equipmentId: machine.id, start, end: start + minutes * MINUTE, ymd: drop.ymd };
    }
    const day = dayBounds(drop.ymd);
    const mine = busy.filter((b) => b.equipmentId === machine.id);
    const slot = firstFreeSlot(machine, mine, minutes, Math.max(day.start, now), { maxDays: 1 });
    const start = slot && slot.length === 1 ? slot[0]!.start : (workWindow(machine, drop.ymd)?.start ?? zonedTime(drop.ymd, 8 * 60));
    return { equipmentId: machine.id, start, end: start + minutes * MINUTE, ymd: drop.ymd };
  };

  const onMove = (e: DragMoveEvent) => {
    const t = target(e);
    setPreview((cur) => (cur?.equipmentId === t?.equipmentId && cur?.start === t?.start && cur?.ymd === t?.ymd ? cur : t));
  };

  const schedulePiece: BoardCtx["schedulePiece"] = (job, piece, at) => {
    const id = pieceId(job.id, piece.key);
    setHidden((s) => new Set(s).add(id));
    startTransition(async () => {
      const r = await scheduleWork({ jobId: job.id, key: piece.key, equipmentId: at?.equipmentId ?? piece.equipmentId, start: at?.start ?? null, minutes: at?.minutes ?? piece.minutes });
      // Booked on a day that isn't on screen: offer to go there.
      const day = r.ok && r.data?.start != null ? ymdAt(r.data.start) : null;
      const show = day && !p.days.includes(day) ? { label: "Show", onClick: () => router.push(`/schedule?view=${p.view}&date=${day}${p.highlightJobId ? `&job=${p.highlightJobId}` : ""}`) } : undefined;
      if (!toastResult(r, "Scheduled", show))
        setHidden((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
      router.refresh();
    });
  };

  const moveTo = (b: BoardBlock, to: { equipmentId: number; start: number; end: number }) => {
    if (b.equipmentId === to.equipmentId && b.start === to.start && b.end === to.end) return;
    setBlocks((bs) => bs.map((x) => (x.id === b.id ? { ...x, ...to } : x)));
    startTransition(async () => {
      const r = await moveScheduleBlock({ id: b.id, equipmentId: to.equipmentId, start: to.start, end: to.end });
      if (!toastResult(r, "Moved")) setBlocks(p.blocks);
      router.refresh();
    });
  };

  const onEnd = (e: DragEndEvent) => {
    const t = target(e);
    const data = e.active.data.current as DragData | undefined;
    setPreview(null);
    setActive(null);
    if (!t || !data) return;
    if (data.type === "block") moveTo(data.block, t);
    else schedulePiece(data.job, data.piece, { equipmentId: t.equipmentId, start: t.start, minutes: data.piece.minutes });
  };

  const ctx: BoardCtx = {
    view: p.view,
    date: p.date,
    days: p.days,
    machines: p.machines,
    machineById,
    blocks,
    busy,
    waiting: p.waiting,
    users: p.users,
    canEdit: p.canEdit,
    highlightJobId: p.highlightJobId,
    now,
    preview,
    hiddenPieces: hidden,
    issuesOf: (b) => issues.get(b.id) ?? blockIssues({ ...b, dueDate: b.job?.dueDate ?? null }, machineById.get(b.equipmentId), blocks),
    openBlock: (block) => setDialog({ kind: "block", block }),
    openPiece: (job, piece) => setDialog({ kind: "piece", job, piece }),
    schedulePiece,
    newBlock: (at) => setDialog({ kind: "new", at }),
    pending,
    geometry,
    resizeBlock: (b, end) => moveTo(b, { equipmentId: b.equipmentId, start: b.start, end }),
  };

  const overlayWidth = active?.type === "block" && p.view === "day" ? Math.max(40, ((active.block.end - active.block.start) / MINUTE) * geometry.current.ppm - 2) : undefined;

  return (
    <BoardProvider value={ctx}>
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={(e: DragStartEvent) => setActive((e.active.data.current as DragData) ?? null)}
        onDragMove={onMove}
        onDragEnd={onEnd}
        onDragCancel={() => {
          setPreview(null);
          setActive(null);
        }}
      >
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <div className="hidden md:block">{p.view === "day" ? <DayGrid /> : <WeekGrid />}</div>
            <div className="md:hidden">
              <PhoneList />
            </div>
            <Legend />
          </div>
          <div className="min-w-0">
            <WaitingPanel onAutoSchedule={() => setDialog({ kind: "auto" })} />
          </div>
        </div>
        <DragOverlay dropAnimation={null}>{active ? <DragPreviewCard data={active} width={overlayWidth} /> : null}</DragOverlay>
      </DndContext>
      {dialog?.kind === "block" && <BlockDialog key={dialog.block.id} block={dialog.block} onClose={() => setDialog(null)} />}
      {dialog?.kind === "new" && <BlockDialog block={null} newAt={dialog.at} onClose={() => setDialog(null)} />}
      {dialog?.kind === "piece" && <PieceDialog job={dialog.job} piece={dialog.piece} onClose={() => setDialog(null)} />}
      {dialog?.kind === "auto" && <AutoScheduleDialog onClose={() => setDialog(null)} />}
    </BoardProvider>
  );
}

function Legend() {
  const item = (cls: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-5 rounded border ${cls}`} />
      {label}
    </span>
  );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-600">
      {item("border-brand-300 bg-brand-50", "Scheduled")}
      {item("border-amber-400 bg-amber-50", "Running")}
      {item("border-emerald-200 bg-emerald-50", "Done")}
      {item("border-brand-300 bg-brand-50 outline-2 outline-red-500", "Ends after the job is due")}
      {item("border-slate-300 bg-slate-200", "Blocked off")}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-0.5 bg-red-500" /> Now
      </span>
    </div>
  );
}
