import Link from "next/link";
import type { Metadata } from "next";
import { CalendarDays, ChevronLeft, ChevronRight, Filter, Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getActiveUsers, getLocations } from "@/lib/lookups";
import { getCalendarItems } from "@/lib/calendar/queries";
import {
  addMonths,
  CAL_TYPES,
  isYmd,
  longDay,
  monthTitle,
  shortDay,
  startOfMonth,
  startOfWeek,
  viewRange,
  weekTitle,
  type CalItem,
  type CalType,
  type CalView,
} from "@/lib/calendar/types";
import { addDays, today } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { AddEventButton, AddOnDay, CalendarProvider, CalEntry } from "./calendar-client";

export const metadata: Metadata = { title: "Calendar" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const VIEWS: { key: CalView; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];
const LOCS = [
  { code: "MUNSTER", label: "Munster" },
  { code: "HAMMOND", label: "Hammond" },
  { code: "OFFSITE", label: "Off-site" },
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type State = { view: CalView; date: string; types: CalType[]; loc: string | null; mine: boolean };

function hrefFor(s: State, patch: Partial<State> = {}) {
  const n = { ...s, ...patch };
  const q = new URLSearchParams();
  if (n.view !== "week") q.set("view", n.view);
  if (n.date !== today()) q.set("date", n.date);
  if (n.types.length) q.set("types", n.types.join(","));
  if (n.loc) q.set("loc", n.loc);
  if (n.mine) q.set("mine", "1");
  const qs = q.toString();
  return qs ? `/calendar?${qs}` : "/calendar";
}

export default async function CalendarPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePagePermission("calendar.view");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const view = (VIEWS.some((v) => v.key === one("view")) ? one("view") : "week") as CalView;
  const date = isYmd(one("date")) ? one("date")! : today();
  const types = (one("types") ?? "").split(",").filter((t): t is CalType => CAL_TYPES.some((c) => c.key === t));
  const loc = LOCS.some((l) => l.code === one("loc")) ? one("loc")! : null;
  const mine = one("mine") === "1";
  const state: State = { view, date, types, loc, mine };

  const { from, to } = viewRange(view, date);
  const [all, users, locations] = await Promise.all([getCalendarItems({ from, to, user }), getActiveUsers(), getLocations()]);
  const items = all.filter((i) => (!types.length || types.includes(i.type)) && (!loc || i.locationCode === loc) && (!mine || i.mine));
  const byDay = new Map<string, CalItem[]>();
  for (const i of items) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
  const filtered = types.length > 0 || loc != null || mine;
  const hidden = all.length - items.length;

  const step = (dir: 1 | -1) =>
    view === "day" ? addDays(date, dir) : view === "week" ? addDays(date, 7 * dir) : addMonths(startOfMonth(date), dir);
  const title = view === "day" ? longDay(date) : view === "week" ? weekTitle(startOfWeek(date)) : monthTitle(date);
  const canEdit = can(user.role, "calendar.edit");
  const t = today();

  return (
    <CalendarProvider canEdit={canEdit} users={users.map((u) => ({ id: u.id, name: u.name }))} locations={locations.map((l) => ({ id: l.id, name: l.name }))}>
      {/* ---- Toolbar ---- */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight text-slate-900 sm:flex-none">{title}</h1>
        <div className="order-3 flex w-full items-center gap-2 sm:order-none sm:w-auto">
          <Link href={hrefFor(state, { date: t })} className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-3.5 text-[15px] font-medium text-slate-800 shadow-sm hover:bg-slate-50">
            Today
          </Link>
          <div className="flex">
            <Link href={hrefFor(state, { date: step(-1) })} aria-label="Previous" className="inline-flex size-10 items-center justify-center rounded-l-lg border border-slate-300 bg-white text-slate-600 shadow-sm hover:bg-slate-50">
              <ChevronLeft className="size-5" />
            </Link>
            <Link href={hrefFor(state, { date: step(1) })} aria-label="Next" className="-ml-px inline-flex size-10 items-center justify-center rounded-r-lg border border-slate-300 bg-white text-slate-600 shadow-sm hover:bg-slate-50">
              <ChevronRight className="size-5" />
            </Link>
          </div>
          <div className="ml-auto flex rounded-lg bg-slate-200/70 p-1 sm:ml-2">
            {VIEWS.map((v) => (
              <Link
                key={v.key}
                href={hrefFor(state, { view: v.key })}
                className={cn("rounded-md px-3 py-1.5 text-[15px] font-medium", v.key === view ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
              >
                {v.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="sm:ml-auto">
          <AddEventButton date={view === "day" ? date : date < t ? date : t} compact />
        </div>
      </div>

      {/* ---- Filters: always visible on desktop, tucked away on phones ---- */}
      <details className="group mb-4 rounded-xl border border-slate-200 bg-white lg:hidden" open={filtered || undefined}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[15px] font-medium text-slate-700">
          <Filter className="size-4 text-slate-400" />
          {filtered ? `Filtered · ${hidden} hidden` : "Filter & colors"}
          <ChevronRight className="ml-auto size-4 text-slate-400 transition-transform group-open:rotate-90" />
        </summary>
        <div className="border-t border-slate-100 px-4 py-3">
          <Filters state={state} />
        </div>
      </details>
      <div className="mb-4 hidden lg:block">
        <Filters state={state} />
      </div>

      {/* ---- Views ---- */}
      {view === "month" && <MonthView state={state} byDay={byDay} from={from} to={to} canEdit={canEdit} />}
      {view === "week" && <WeekView state={state} byDay={byDay} from={from} canEdit={canEdit} />}
      {view === "day" && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          {(byDay.get(date) ?? []).length ? (
            <div className="space-y-2">
              {byDay.get(date)!.map((i) => (
                <CalEntry key={i.key} item={i} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={CalendarDays}
              title={filtered ? "Nothing matches these filters on this day" : "Nothing scheduled this day"}
              description={canEdit ? "Use “Add event” for reminders, deliveries or appointments." : undefined}
            />
          )}
        </div>
      )}
      {filtered && hidden > 0 && (
        <p className="mt-3 text-sm text-slate-500">
          {hidden} {hidden === 1 ? "item is" : "items are"} hidden by filters.{" "}
          <Link href={hrefFor(state, { types: [], loc: null, mine: false })} className="font-medium text-brand-600 hover:underline">
            Show everything
          </Link>
        </p>
      )}
    </CalendarProvider>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium whitespace-nowrap",
        active ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
      )}
    >
      {children}
    </Link>
  );
}

function Filters({ state }: { state: State }) {
  const toggleType = (k: CalType) => (state.types.includes(k) ? state.types.filter((x) => x !== k) : [...state.types, k]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {CAL_TYPES.map((c) => (
        <Chip key={c.key} href={hrefFor(state, { types: toggleType(c.key) })} active={state.types.includes(c.key)}>
          <span className={cn("size-2.5 rounded-full", c.dot)} />
          {c.label}
        </Chip>
      ))}
      <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />
      {LOCS.map((l) => (
        <Chip key={l.code} href={hrefFor(state, { loc: state.loc === l.code ? null : l.code })} active={state.loc === l.code}>
          {l.label}
        </Chip>
      ))}
      <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />
      <Chip href={hrefFor(state, { mine: !state.mine })} active={state.mine}>
        Only mine
      </Chip>
      {(state.types.length > 0 || state.loc || state.mine) && (
        <Link href={hrefFor(state, { types: [], loc: null, mine: false })} className="px-2 text-sm font-medium text-brand-600 hover:underline">
          Clear filters
        </Link>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agenda list (phones, and the week view below desktop width)
// ---------------------------------------------------------------------------
function Agenda({ days, byDay, state, showEmpty }: { days: string[]; byDay: Map<string, CalItem[]>; state: State; showEmpty: boolean }) {
  const t = today();
  const list = showEmpty ? days : days.filter((d) => byDay.get(d)?.length || d === t);
  if (!list.length)
    return (
      <div className="rounded-xl border border-slate-200 bg-white">
        <EmptyState icon={CalendarDays} title="Nothing scheduled" description="Nothing on the calendar for these dates." />
      </div>
    );
  return (
    <div className="space-y-4">
      {list.map((d) => {
        const dayItems = byDay.get(d) ?? [];
        return (
          <section key={d}>
            <h2 className={cn("mb-1.5 flex items-baseline gap-2 px-1 text-[15px] font-semibold", d === t ? "text-brand-700" : "text-slate-800")}>
              <Link href={hrefFor(state, { view: "day", date: d })} className="hover:underline">
                {d === t ? "Today · " : d === addDays(t, 1) ? "Tomorrow · " : ""}
                {shortDay(d)}
              </Link>
              {dayItems.length > 0 && <span className="text-sm font-normal text-slate-400">{dayItems.length}</span>}
            </h2>
            {dayItems.length ? (
              <div className="space-y-1.5">
                {dayItems.map((i) => (
                  <CalEntry key={i.key} item={i} />
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2.5 text-sm text-slate-400">Nothing scheduled</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Week
// ---------------------------------------------------------------------------
function WeekView({ state, byDay, from, canEdit }: { state: State; byDay: Map<string, CalItem[]>; from: string; canEdit: boolean }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const t = today();
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:grid lg:grid-cols-7">
        {days.map((d, idx) => {
          const dayItems = byDay.get(d) ?? [];
          return (
            <div key={d} className={cn("group flex min-h-[26rem] min-w-0 flex-col border-slate-200", idx > 0 && "border-l", d === t && "bg-brand-50/40")}>
              <div className="flex items-center justify-between border-b border-slate-100 px-2.5 py-2">
                <Link href={hrefFor(state, { view: "day", date: d })} className="flex items-baseline gap-1.5 hover:underline">
                  <span className="text-xs font-medium uppercase text-slate-500">{WEEKDAYS[idx]}</span>
                  <span className={cn("text-lg font-semibold", d === t ? "flex size-7 items-center justify-center rounded-full bg-brand-500 text-base text-white" : "text-slate-900")}>
                    {Number(d.slice(8))}
                  </span>
                </Link>
                {canEdit && (
                  <AddOnDay date={d} className="rounded p-1 text-slate-300 opacity-0 hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100 focus:opacity-100">
                    <Plus className="size-4" />
                  </AddOnDay>
                )}
              </div>
              <div className="flex-1 space-y-1.5 p-1.5">
                {dayItems.map((i) => (
                  <CalEntry key={i.key} item={i} variant="block" />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="lg:hidden">
        <Agenda days={days} byDay={byDay} state={state} showEmpty />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Month
// ---------------------------------------------------------------------------
function MonthView({ state, byDay, from, to, canEdit }: { state: State; byDay: Map<string, CalItem[]>; from: string; to: string; canEdit: boolean }) {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const month = state.date.slice(0, 7);
  const t = today();
  const MAX = 3;
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-medium uppercase tracking-wide text-slate-500">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-2">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, idx) => {
            const dayItems = byDay.get(d) ?? [];
            const inMonth = d.slice(0, 7) === month;
            return (
              <div
                key={d}
                className={cn("group min-h-32 min-w-0 border-slate-200 p-1.5", idx % 7 > 0 && "border-l", idx >= 7 && "border-t", !inMonth && "bg-slate-50/70", d === t && "bg-brand-50/50")}
              >
                <div className="mb-1 flex items-center justify-between">
                  <Link
                    href={hrefFor(state, { view: "day", date: d })}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full text-sm font-semibold hover:bg-slate-100",
                      d === t ? "bg-brand-500 text-white hover:bg-brand-600" : inMonth ? "text-slate-800" : "text-slate-400",
                    )}
                  >
                    {Number(d.slice(8))}
                  </Link>
                  {canEdit && (
                    <AddOnDay date={d} className="rounded p-1 text-slate-300 opacity-0 hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100 focus:opacity-100">
                      <Plus className="size-4" />
                    </AddOnDay>
                  )}
                </div>
                <div className="space-y-1">
                  {dayItems.slice(0, MAX).map((i) => (
                    <CalEntry key={i.key} item={i} variant="chip" />
                  ))}
                  {dayItems.length > MAX && (
                    <Link href={hrefFor(state, { view: "day", date: d })} className="block px-1.5 text-xs font-medium text-slate-500 hover:text-slate-800">
                      +{dayItems.length - MAX} more
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="sm:hidden">
        <Agenda days={days.filter((d) => d.slice(0, 7) === month)} byDay={byDay} state={state} showEmpty={false} />
      </div>
    </>
  );
}
