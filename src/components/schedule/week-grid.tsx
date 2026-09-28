"use client";
import * as React from "react";
import Link from "next/link";
import { useDroppable } from "@dnd-kit/core";
import { today } from "@/lib/format";
import { dayLoad } from "@/lib/schedule/logic";
import { dayBounds, dayLabel, hoursLabel, rangeLabel } from "@/lib/schedule/time";
import { MACHINE_KIND_SHORT, type BoardMachine } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";
import { useBoard } from "./board-context";
import { ChipBlock } from "./block-view";
import { LoadBar } from "./day-grid";

/** Machines down the side, Monday–Sunday across: booked vs. capacity per day, and the bookings. */
export function WeekGrid() {
  const { days, machines } = useBoard();
  const t = today();
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[980px] table-fixed border-collapse">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <th className="sticky left-0 z-10 w-48 border-r border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">Machine</th>
            {days.map((d) => (
              <th key={d} className={cn("px-2 py-2 text-left text-sm font-semibold whitespace-nowrap", d === t ? "bg-brand-50 text-brand-700" : "text-slate-700")}>
                <Link href={`/schedule?view=day&date=${d}`} className="hover:underline">
                  {dayLabel(d)}
                </Link>
                {d === t && <span className="ml-1 inline-block size-2 rounded-full bg-brand-500 align-middle" title="Today" aria-label="Today" />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => (
            <tr key={m.id} className="border-b border-slate-100 last:border-b-0">
              <th scope="row" className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-2 text-left align-top font-normal">
                <p className="truncate text-[15px] leading-tight font-semibold text-slate-900" title={m.name}>
                  {m.name}
                </p>
                <p className="text-xs text-slate-500">{MACHINE_KIND_SHORT[m.kind]}</p>
              </th>
              {days.map((d) => (
                <WeekCell key={d} machine={m} ymd={d} isToday={d === t} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WeekCell({ machine: m, ymd, isToday }: { machine: BoardMachine; ymd: string; isToday: boolean }) {
  const { blocks, preview } = useBoard();
  const { setNodeRef, isOver } = useDroppable({ id: `c:${m.id}:${ymd}`, data: { equipmentId: m.id, ymd } });
  const day = dayBounds(ymd);
  const mine = blocks.filter((b) => b.equipmentId === m.id && b.start < day.end && b.end > day.start);
  const load = dayLoad(m, blocks, ymd);
  const over = load.booked > load.capacity;
  const off = load.capacity === 0;
  const showPreview = preview?.ymd === ymd && preview.equipmentId === m.id;
  return (
    <td
      ref={setNodeRef}
      className={cn(
        "relative h-24 border-l border-slate-100 px-1.5 pt-1.5 pb-8 align-top",
        off && "bg-[repeating-linear-gradient(135deg,#f8fafc_0,#f8fafc_8px,#f1f5f9_8px,#f1f5f9_16px)]",
        isToday && !off && "bg-brand-50/30",
        isOver && "bg-brand-100/70 ring-2 ring-brand-400 ring-inset",
      )}
    >
      <div className="mb-1.5">
        <div className="mb-0.5 flex items-baseline justify-between gap-1 text-xs tabular-nums">
          {off ? (
            <span className={cn(load.booked ? "font-semibold text-red-600" : "text-slate-400")}>{load.booked ? `${hoursLabel(load.booked)} hr · day off` : "Off"}</span>
          ) : (
            <span className={cn(over ? "font-semibold text-red-600" : "text-slate-600")}>
              {hoursLabel(load.booked)} / {hoursLabel(load.capacity)} hr
            </span>
          )}
          {over && !off && <span className="font-semibold text-red-600">Over</span>}
        </div>
        {!off && <LoadBar booked={load.booked} capacity={load.capacity} className="h-2" />}
      </div>
      <div className="space-y-1">
        {mine.map((b) => (
          <ChipBlock key={b.id} b={b} />
        ))}
        {showPreview && (
          <div className="absolute inset-x-1.5 bottom-1 z-10 rounded-md border-2 border-dashed border-brand-500 bg-white/90 px-1.5 py-0.5 text-xs font-medium text-brand-700">{rangeLabel(preview!.start, preview!.end).replace(/^\w{3} /, "")}</div>
        )}
      </div>
    </td>
  );
}
