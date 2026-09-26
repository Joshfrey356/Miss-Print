"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { JobCardView, sortCards, type BoardCard } from "@/components/jobs/job-card";
import { Logo, type LogoBrand } from "@/components/logo";
import { cn } from "@/lib/utils";

/** `location` is the name of the location shown (from ?location=<code>), or null for all. */
type Props = { brand: LogoBrand; location: string | null; dueToday: BoardCard[]; rush: BoardCard[]; printing: BoardCard[]; upNext: BoardCard[]; installs: BoardCard[]; ready: BoardCard[] };

export function TvBoard(p: Props) {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const clock = setInterval(() => setNow(new Date()), 15000);
    const refresh = setInterval(() => router.refresh(), 60000);
    return () => {
      clearInterval(clock);
      clearInterval(refresh);
    };
  }, [router]);

  const cols: { title: string; jobs: BoardCard[]; tone?: string }[] = [
    { title: "Due today & late", jobs: p.dueToday, tone: "text-red-300" },
    { title: "Rush", jobs: p.rush, tone: "text-orange-300" },
    { title: "Up next", jobs: p.upNext },
    { title: "Printing & finishing", jobs: p.printing },
    { title: "Installs", jobs: p.installs },
    { title: "Ready", jobs: p.ready, tone: "text-emerald-300" },
  ];

  return (
    <div className="min-h-dvh bg-slate-900 p-6 text-white">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-baseline gap-4">
          <Logo brand={p.brand} inverted className="self-center" />
          <span className="text-xl font-medium text-slate-300">Production{p.location ? ` · ${p.location}` : ""}</span>
        </div>
        <div className="text-right">
          <p className="tabular text-4xl font-semibold">{now ? now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) : ""}</p>
          <p className="text-slate-400">{now ? now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" }) : ""}</p>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        {cols.map((c) => (
          <section key={c.title} className="rounded-2xl bg-slate-800 p-3">
            <h2 className={cn("mb-3 flex items-center justify-between px-1 text-xl font-semibold", c.tone ?? "text-slate-100")}>
              {c.title}
              <span className="rounded-full bg-slate-700 px-2.5 text-lg text-slate-200">{c.jobs.length}</span>
            </h2>
            <div className="space-y-2.5">
              {[...c.jobs].sort(sortCards).slice(0, 7).map((j) => (
                <div key={j.id} className="text-slate-900">
                  <JobCardView job={j} tv />
                </div>
              ))}
              {c.jobs.length > 7 && <p className="px-1 text-slate-400">+ {c.jobs.length - 7} more</p>}
              {c.jobs.length === 0 && <p className="px-1 py-4 text-lg text-slate-500">Nothing here</p>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
