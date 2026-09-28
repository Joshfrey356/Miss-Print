"use client";
import * as React from "react";
import { AlertTriangle, CheckCircle2, Play } from "lucide-react";
import { useJobNo } from "@/components/shop-context";
import { dayLoad } from "@/lib/schedule/logic";
import { dayBounds, dayLabel, hoursLabel, rangeLabel, ymdAt } from "@/lib/schedule/time";
import { MACHINE_KIND_SHORT } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";
import { useBoard } from "./board-context";
import { blockClasses, blockStripe, stepText } from "./block-view";
import { LoadBar } from "./day-grid";

/** Phones: a list per machine. Tap a booking to start it, finish it or change it. */
export function PhoneList() {
  const { machines, blocks, view, date, days, issuesOf, openBlock, highlightJobId } = useBoard();
  const jobNo = useJobNo();
  const range = { start: dayBounds(days[0]!).start, end: dayBounds(days[days.length - 1]!).end };
  return (
    <div className="space-y-3">
      {machines.map((m) => {
        const mine = blocks.filter((b) => b.equipmentId === m.id && b.start < range.end && b.end > range.start);
        const load = view === "day" ? dayLoad(m, blocks, date) : null;
        return (
          <section key={m.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <header className="border-b border-slate-100 px-4 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="truncate text-[15px] font-semibold text-slate-900">{m.name}</h3>
                <span className="shrink-0 text-xs text-slate-500">{MACHINE_KIND_SHORT[m.kind]}</span>
              </div>
              {load && (
                <div className="mt-1 flex items-center gap-2">
                  <LoadBar booked={load.booked} capacity={load.capacity} className="flex-1" />
                  <span className={cn("text-xs tabular-nums", load.booked > load.capacity ? "font-semibold text-red-600" : "text-slate-500")}>
                    {load.capacity ? `${hoursLabel(load.booked)} of ${hoursLabel(load.capacity)} hr` : load.booked ? `${hoursLabel(load.booked)} hr on a day off` : "Off today"}
                  </span>
                </div>
              )}
            </header>
            {mine.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">Nothing booked{view === "day" ? " today" : " this week"}.</p>
            ) : (
              <ul className="space-y-2 p-2.5">
                {mine.map((b) => {
                  const issues = issuesOf(b);
                  return (
                    <li key={b.id}>
                      <button type="button" onClick={() => openBlock(b)} className={cn("relative block w-full overflow-hidden py-2 pr-3 pl-4", blockClasses(b, issues, !!highlightJobId && b.job?.id === highlightJobId))}>
                        <span className={cn("absolute inset-y-0 left-0 w-1.5", blockStripe(b))} />
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          {b.status === "running" && <Play className="size-3.5 text-amber-600" />}
                          {b.status === "done" && <CheckCircle2 className="size-3.5 text-emerald-600" />}
                          {view === "week" ? `${dayLabel(ymdAt(b.start))} · ` : ""}
                          {rangeLabel(b.start, b.end).replace(/^\w{3} /, "")}
                          {issues.some((i) => i.kind !== "late") && <AlertTriangle className="ml-auto size-4 text-amber-600" />}
                        </span>
                        <span className="block truncate text-[15px]">{b.job ? `${jobNo(b.job.number)} · ${b.job.customer}` : b.title}</span>
                        {b.job && <span className="block truncate text-sm opacity-80">{stepText(b)} · {b.job.title}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
