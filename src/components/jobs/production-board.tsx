"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { toast } from "sonner";
import { BOARD_COLUMNS, STATUS_LABELS, type BoardColumn } from "@/lib/jobs/workflow";
import { addDays, today } from "@/lib/format";
import { cn } from "@/lib/utils";
import { moveJobOnBoard } from "@/app/(app)/jobs/actions";
import { JobCardView, sortCards, type BoardCard } from "./job-card";

type Person = { id: number; name: string };
export type BoardJob = BoardCard & { designer: string | null; production: string | null; installer: string | null; sales: string | null };

const FILTERS = [
  { key: "today", label: "Due today" },
  { key: "week", label: "This week" },
  { key: "rush", label: "Rush" },
  { key: "MUNSTER", label: "Munster" },
  { key: "HAMMOND", label: "Hammond" },
];
const DEPARTMENTS = [
  { key: "front", label: "Front counter" },
  { key: "design", label: "Design" },
  { key: "production", label: "Production" },
  { key: "install", label: "Installation" },
];

export function ProductionBoard({ jobs: initial, people, canMove }: { jobs: BoardJob[]; people: Person[]; canMove: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [jobs, setJobs] = useState(initial);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  // Resync when the server sends fresh data.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setJobs(initial);
  }

  const active = new Set((params.get("f") ?? "").split(",").filter(Boolean));
  const dept = params.get("dept") ?? "";
  const person = params.get("person") ?? "";
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  const toggle = (key: string) => {
    const s = new Set(active);
    if (s.has(key)) s.delete(key);
    else {
      s.add(key);
      if (key === "MUNSTER") s.delete("HAMMOND");
      if (key === "HAMMOND") s.delete("MUNSTER");
      if (key === "today") s.delete("week");
      if (key === "week") s.delete("today");
    }
    setParam("f", [...s].join(","));
  };

  const t = today();
  const filtered = useMemo(() => {
    const personName = people.find((p) => String(p.id) === person)?.name;
    return jobs.filter((j) => {
      if (active.has("today") && !(j.dueDate && j.dueDate <= t)) return false;
      if (active.has("week") && !(j.dueDate && j.dueDate <= addDays(t, 7))) return false;
      if (active.has("rush") && j.priority === "normal") return false;
      if (active.has("MUNSTER") && j.locationCode !== "MUNSTER") return false;
      if (active.has("HAMMOND") && j.locationCode !== "HAMMOND") return false;
      if (personName && ![j.designer, j.production, j.installer, j.sales].includes(personName)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, params, people, t]);

  const columns = BOARD_COLUMNS.filter((c) => !dept || c.department === dept || (dept === "front" && c.key === "complete"));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }));

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const jobId = Number(e.active.id);
    const colKey = e.over?.id as string | undefined;
    if (!colKey) return;
    const col = BOARD_COLUMNS.find((c) => c.key === colKey)!;
    const job = jobs.find((j) => j.id === jobId);
    if (!job || col.statuses.includes(job.status)) return;
    const before = jobs;
    setJobs((js) => js.map((j) => (j.id === jobId ? { ...j, status: col.dropStatus, overdue: col.dropStatus === "completed" ? false : j.overdue } : j)));
    startTransition(async () => {
      const r = await moveJobOnBoard(jobId, colKey, null);
      if (!r.ok) {
        setJobs(before);
        toast.error(r.error);
      } else toast.success(`MP-${job.number} → ${STATUS_LABELS[col.dropStatus]}`);
    });
  }

  const activeJob = jobs.find((j) => j.id === activeId);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => toggle(f.key)}
            className={cn(
              "h-9 rounded-full border px-3.5 text-sm font-medium",
              active.has(f.key) ? "border-brand-500 bg-brand-500 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            {f.label}
          </button>
        ))}
        <select value={dept} onChange={(e) => setParam("dept", e.target.value)} className={cn("h-9 rounded-full border bg-white pl-3.5 pr-8 text-sm font-medium", dept ? "border-brand-500 text-brand-700" : "border-slate-200 text-slate-700")} aria-label="Department">
          <option value="">All departments</option>
          {DEPARTMENTS.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </select>
        <select value={person} onChange={(e) => setParam("person", e.target.value)} className={cn("h-9 rounded-full border bg-white pl-3.5 pr-8 text-sm font-medium", person ? "border-brand-500 text-brand-700" : "border-slate-200 text-slate-700")} aria-label="Employee">
          <option value="">Everyone</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {(active.size > 0 || dept || person) && (
          <button onClick={() => router.replace(pathname)} className="text-sm text-slate-500 underline-offset-2 hover:underline">
            Clear filters
          </button>
        )}
        <span className="ml-auto hidden text-sm text-slate-500 md:block">{canMove ? "Drag a card to move it to the next stage." : ""}</span>
      </div>

      <DndContext id="production-board" sensors={sensors} onDragStart={(e) => setActiveId(Number(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="scroll-thin -mx-4 flex gap-3 overflow-x-auto px-4 pb-4 lg:-mx-8 lg:px-8">
          {columns.map((col) => (
            <Column key={col.key} col={col} jobs={filtered.filter((j) => col.statuses.includes(j.status)).sort(sortCards)} canMove={canMove} />
          ))}
        </div>
        <DragOverlay>{activeJob ? <JobCardView job={activeJob} dragging /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({ col, jobs, canMove }: { col: BoardColumn; jobs: BoardJob[]; canMove: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key, disabled: !canMove });
  const overdue = jobs.filter((j) => j.overdue).length;
  return (
    <div ref={setNodeRef} className={cn("flex w-72 shrink-0 flex-col rounded-xl bg-slate-100/80 p-2", isOver && "bg-brand-50 ring-2 ring-brand-300")}>
      <div className="flex items-center justify-between px-1.5 pb-2 pt-1">
        <h3 className="text-sm font-semibold text-slate-700">{col.title}</h3>
        <span className="flex items-center gap-1.5">
          {overdue > 0 && <span className="rounded-full bg-red-100 px-1.5 text-xs font-semibold text-red-700">{overdue} late</span>}
          <span className="rounded-full bg-white px-2 text-xs font-medium text-slate-600">{jobs.length}</span>
        </span>
      </div>
      <div className="flex min-h-24 flex-col gap-2">
        {jobs.map((j) => (
          <DraggableCard key={j.id} job={j} canMove={canMove} />
        ))}
        {jobs.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-400">Nothing here</p>}
      </div>
    </div>
  );
}

function DraggableCard({ job, canMove }: { job: BoardJob; canMove: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: job.id, disabled: !canMove });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn("touch-manipulation", isDragging && "opacity-30")}>
      <Link href={`/jobs/${job.number}`} draggable={false} className="block" onClick={(e) => isDragging && e.preventDefault()}>
        <JobCardView job={job} />
      </Link>
    </div>
  );
}
