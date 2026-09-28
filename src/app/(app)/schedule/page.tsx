import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Printer, X } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { getActiveUsers } from "@/lib/lookups";
import { addDays, jobNo, today } from "@/lib/format";
import { getJobPrefix } from "@/lib/tenant";
import { loadBlocks, loadBusy, loadJobBlocks, loadMachines, loadWaiting } from "@/lib/schedule/queries";
import { dayBounds, dayLabel, mondayOf, ymdAt } from "@/lib/schedule/time";
import type { ScheduleView } from "@/lib/schedule/types";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { ScheduleBoard } from "@/components/schedule/schedule-board";
import { ScheduleToolbarButtons } from "@/components/schedule/toolbar-buttons";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Schedule" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

type State = { view: ScheduleView; date: string; job: number | null };
function hrefFor(s: State, patch: Partial<State> = {}) {
  const n = { ...s, ...patch };
  const q = new URLSearchParams();
  if (n.view !== "day") q.set("view", n.view);
  if (n.date !== today()) q.set("date", n.date);
  if (n.job) q.set("job", String(n.job));
  const qs = q.toString();
  return qs ? `/schedule?${qs}` : "/schedule";
}

function weekTitle(from: string) {
  const to = addDays(from, 6);
  const f = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...o });
  return `${f(from, { month: "short", day: "numeric" })} – ${from.slice(0, 7) === to.slice(0, 7) ? f(to, { day: "numeric" }) : f(to, { month: "short", day: "numeric" })}, ${to.slice(0, 4)}`;
}

/**
 * Equipment schedule: what runs on which machine, when. Viewing needs the company dashboard or
 * scheduling; booking needs schedule.edit (owner, manager, production).
 */
export default async function SchedulePage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const canEdit = can(user.role, "schedule.edit");
  if (!canEdit && !can(user.role, "dashboard.company")) redirect("/no-access");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const view: ScheduleView = one("view") === "week" ? "week" : "day";
  const jobParam = Number(one("job")) || null;

  const [machines, prefix] = await Promise.all([loadMachines(user.tenantId), getJobPrefix(user.tenantId)]);

  // ?job=<id> (from the job page): that job's work is highlighted; open on its first booking.
  let highlight: { id: number; number: number; title: string } | null = null;
  let date = isYmd(one("date")) ? one("date")! : today();
  if (jobParam) {
    const [j] = await db.select({ id: jobs.id, number: jobs.number, title: jobs.title }).from(jobs).where(and(eq(jobs.tenantId, user.tenantId), eq(jobs.id, jobParam)));
    highlight = j ?? null;
    if (highlight && !isYmd(one("date"))) {
      const booked = (await loadJobBlocks(user.tenantId, [highlight.id])).filter((b) => b.status !== "done");
      const next = booked.find((b) => b.end > Date.now()) ?? booked[booked.length - 1];
      if (next) date = ymdAt(Math.max(next.start, Date.now()));
    }
  }
  const state: State = { view, date, job: highlight?.id ?? null };

  if (!machines.length)
    return (
      <div>
        <h1 className="mb-4 text-2xl font-semibold tracking-tight text-slate-900">Schedule</h1>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <EmptyState
            icon={Printer}
            title="No machines to schedule yet"
            description="Add your presses, cutter and folder in Settings → Presses & Equipment, with the hours they run. Then book jobs on them here."
            action={can(user.role, "pricing.edit") ? <LinkButton href="/settings/equipment" variant="primary">Add machines</LinkButton> : undefined}
          />
        </div>
      </div>
    );

  const days = view === "day" ? [date] : Array.from({ length: 7 }, (_, i) => addDays(mondayOf(date), i));
  const from = dayBounds(days[0]!).start;
  const to = dayBounds(days[days.length - 1]!).end;
  const now = Date.now();
  const [blocks, busy, waiting, users] = await Promise.all([
    loadBlocks(user.tenantId, from, to),
    loadBusy(user.tenantId, machines.map((m) => m.id), now),
    loadWaiting(user.tenantId, { alsoJobId: highlight?.id ?? null, machines }),
    getActiveUsers(user.tenantId),
  ]);
  const waitingCount = waiting.reduce((s, j) => s + j.pieces.length, 0);
  const step = view === "day" ? 1 : 7;
  const t = today();
  const title = view === "day" ? dayLabel(date, { long: true }) : weekTitle(days[0]!);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 sm:flex-none">
          <p className="text-sm font-medium text-slate-500">Schedule</p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        </div>
        <div className="order-3 flex w-full items-center gap-2 sm:order-none sm:w-auto">
          <Link href={hrefFor(state, { date: t })} className={cn("inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-3.5 text-[15px] font-medium text-slate-800 shadow-sm hover:bg-slate-50", days.includes(t) && "border-brand-300 text-brand-700")}>
            Today
          </Link>
          <div className="flex">
            <Link href={hrefFor(state, { date: addDays(date, -step) })} aria-label={view === "day" ? "Previous day" : "Previous week"} className="inline-flex size-10 items-center justify-center rounded-l-lg border border-slate-300 bg-white text-slate-600 shadow-sm hover:bg-slate-50">
              <ChevronLeft className="size-5" />
            </Link>
            <Link href={hrefFor(state, { date: addDays(date, step) })} aria-label={view === "day" ? "Next day" : "Next week"} className="-ml-px inline-flex size-10 items-center justify-center rounded-r-lg border border-slate-300 bg-white text-slate-600 shadow-sm hover:bg-slate-50">
              <ChevronRight className="size-5" />
            </Link>
          </div>
          <div className="ml-auto flex rounded-lg bg-slate-200/70 p-1 sm:ml-2">
            {(["day", "week"] as const).map((v) => (
              <Link key={v} href={hrefFor(state, { view: v })} aria-current={v === view ? "page" : undefined} className={cn("rounded-md px-3 py-1.5 text-[15px] font-medium", v === view ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}>
                {v === "day" ? "Day" : "Week"}
              </Link>
            ))}
          </div>
        </div>
        {canEdit && (
          <div className="hidden flex-wrap items-center gap-2 sm:ml-auto sm:flex">
            <ScheduleToolbarButtons waitingCount={waitingCount} />
          </div>
        )}
      </div>

      {highlight && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-[15px] text-violet-900">
          Showing{" "}
          <Link href={`/jobs/${highlight.number}`} className="font-semibold hover:underline">
            {jobNo(highlight.number, prefix)} {highlight.title}
          </Link>
          {waiting.some((j) => j.id === highlight.id) ? " — its work waiting to be scheduled is at the top of the list." : " — outlined in purple on the board."}
          <Link href={hrefFor(state, { job: null })} className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-violet-700 hover:underline">
            <X className="size-4" /> Stop highlighting
          </Link>
        </div>
      )}

      <ScheduleBoard
        view={view}
        date={date}
        days={days}
        machines={machines}
        blocks={blocks}
        busy={busy}
        waiting={waiting}
        users={users.map((u) => ({ id: u.id, name: u.name }))}
        canEdit={canEdit}
        highlightJobId={highlight?.id ?? null}
        now={now}
      />
    </div>
  );
}
