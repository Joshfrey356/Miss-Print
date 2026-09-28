"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Logo, type LogoBrand } from "@/components/logo";
import { useJobNo } from "@/components/shop-context";
import { dueLabel } from "@/lib/format";
import { clock, localParts } from "@/lib/schedule/time";
import { MACHINE_KIND_SHORT, type BoardBlock, type BoardMachine } from "@/lib/schedule/types";
import { cn } from "@/lib/utils";
import { stepText } from "@/components/schedule/block-view";

/** Shop-floor monitor: today's bookings per machine, big and glanceable. No prices. */
export function MachinesTv({ brand, machines, blocks, today }: { brand: LogoBrand; machines: BoardMachine[]; blocks: BoardBlock[]; today: string }) {
  const router = useRouter();
  const jobNo = useJobNo();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const clockT = setInterval(() => setNow(Date.now()), 15000);
    const refresh = setInterval(() => router.refresh(), 60000);
    return () => {
      clearInterval(clockT);
      clearInterval(refresh);
    };
  }, [router]);

  const time = (ms: number) => {
    const p = localParts(ms);
    return p.ymd === today ? clock(p.minute) : "…";
  };

  return (
    <div className="min-h-dvh bg-slate-900 p-6 text-white">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-baseline gap-4">
          <Logo brand={brand} inverted className="self-center" />
          <span className="text-xl font-medium text-slate-300">Today on the machines</span>
        </div>
        <div className="text-right">
          <p className="text-4xl font-semibold tabular-nums">{now ? new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) : ""}</p>
          <p className="text-slate-400">{now ? new Date(now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" }) : ""}</p>
        </div>
      </header>
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(machines.length, 1), 6)}, minmax(0, 1fr))` }}>
        {machines.map((m) => {
          const mine = blocks.filter((b) => b.equipmentId === m.id).sort((a, b) => a.start - b.start);
          const nextUp = now ? mine.find((b) => b.status === "scheduled" && b.end > now) : undefined;
          return (
            <section key={m.id} className="rounded-2xl bg-slate-800 p-3">
              <h2 className="mb-3 px-1 text-xl font-semibold text-slate-100">
                {m.name}
                <span className="ml-2 text-base font-normal text-slate-400">{MACHINE_KIND_SHORT[m.kind]}</span>
              </h2>
              <div className="space-y-2.5">
                {mine.length === 0 && <p className="px-1 py-4 text-lg text-slate-500">Nothing booked today</p>}
                {mine.map((b) => {
                  const late = !!b.job?.dueDate && b.status !== "done" && localParts(b.end - 1).ymd > b.job.dueDate;
                  return (
                    <div
                      key={b.id}
                      className={cn(
                        "rounded-xl border-l-8 px-3 py-2.5",
                        b.status === "running" ? "border-amber-400 bg-amber-100 text-amber-950" : b.status === "done" ? "border-emerald-500 bg-slate-700/60 text-slate-400" : "border-sky-400 bg-white text-slate-900",
                        b === nextUp && "ring-4 ring-sky-400/60",
                        late && "outline-4 outline-red-500",
                      )}
                    >
                      <p className="flex items-center gap-2 text-lg font-semibold tabular-nums">
                        {time(b.start)} – {time(b.end)}
                        {b.status === "running" && <span className="rounded bg-amber-500 px-2 py-0.5 text-sm font-bold text-white uppercase">Running</span>}
                        {b.status === "done" && <CheckCircle2 className="size-5 text-emerald-400" />}
                        {b === nextUp && <span className="rounded bg-sky-500 px-2 py-0.5 text-sm font-bold text-white uppercase">Next</span>}
                      </p>
                      {b.job ? (
                        <>
                          <p className="truncate text-xl font-bold">
                            {jobNo(b.job.number)} · {b.job.customer}
                          </p>
                          <p className="truncate text-lg">
                            {stepText(b)} · {b.job.title}
                          </p>
                          <p className={cn("text-base", late ? "font-bold text-red-600" : "opacity-75")}>
                            {late && <AlertTriangle className="mr-1 inline size-4" />}Due {dueLabel(b.job.dueDate, today)}
                            {b.operatorName ? ` · ${b.operatorName}` : ""}
                          </p>
                        </>
                      ) : (
                        <p className="truncate text-xl font-bold">{b.title}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
