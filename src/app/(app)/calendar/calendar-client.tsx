"use client";
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CalendarPlus, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { Confirm } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { calType, EVENT_TYPE_LABELS, type CalItem, type EditableEvent } from "@/lib/calendar/types";
import type { EventType } from "@/lib/db/schema";
import { fmtDate, today } from "@/lib/format";
import { useJobNo } from "@/components/shop-context";
import { cn } from "@/lib/utils";
import { archiveEvent, saveEvent } from "./actions";

type Option = { id: number; name: string };
const hm12 = (hm: string) => {
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
type Ctx = { canEdit: boolean; open: (e: EditableEvent | null, date?: string) => void };
const CalendarCtx = React.createContext<Ctx>({ canEdit: false, open: () => {} });

/** Holds the single add/edit dialog for the page. */
export function CalendarProvider({ canEdit, users, locations, children }: { canEdit: boolean; users: Option[]; locations: Option[]; children: React.ReactNode }) {
  const [state, setState] = React.useState<{ event: EditableEvent | null; date: string } | null>(null);
  const open = React.useCallback((event: EditableEvent | null, date?: string) => setState({ event, date: date ?? event?.date ?? today() }), []);
  return (
    <CalendarCtx.Provider value={{ canEdit, open }}>
      {children}
      {state && <EventDialog event={state.event} date={state.date} canEdit={canEdit} users={users} locations={locations} onClose={() => setState(null)} />}
    </CalendarCtx.Provider>
  );
}

export function AddEventButton({ date, compact }: { date: string; compact?: boolean }) {
  const { canEdit, open } = React.useContext(CalendarCtx);
  if (!canEdit) return null;
  return (
    <Button variant="primary" onClick={() => open(null, date)} aria-label="Add reminder or event">
      <CalendarPlus className="size-5" />
      <span className={cn(compact && "hidden sm:inline")}>Add event</span>
    </Button>
  );
}

/** Click an empty day cell (month/week) to add an event on that day. */
export function AddOnDay({ date, className, children }: { date: string; className?: string; children?: React.ReactNode }) {
  const { canEdit, open } = React.useContext(CalendarCtx);
  if (!canEdit) return <div className={className}>{children}</div>;
  return (
    <button type="button" onClick={() => open(null, date)} className={cn("text-left", className)} aria-label={`Add event on ${fmtDate(date)}`}>
      {children}
    </button>
  );
}

/** One calendar entry. "chip" = compact (month/week grid), "row" = roomy (day/agenda list). */
export function CalEntry({ item, variant = "row" }: { item: CalItem; variant?: "chip" | "block" | "row" }) {
  const { open } = React.useContext(CalendarCtx);
  const t = calType(item.type);
  const body =
    variant === "block" ? (
      <span className={cn("block w-full rounded-md border-l-[3px] px-2 py-1.5 text-left text-[13px] leading-snug", t.chip, item.overdue && "border-red-600 bg-red-50 text-red-900")}>
        <span className="flex items-center gap-1 text-xs font-semibold">
          {item.overdue && <AlertTriangle className="size-3 shrink-0 text-red-600" />}
          {item.overdue ? "Overdue" : (item.time ?? (item.kind === "job_due" ? "Due" : "All day"))}
        </span>
        <span className="line-clamp-3 break-words">{item.title}</span>
      </span>
    ) : variant === "chip" ? (
      <span className={cn("flex w-full min-w-0 items-center gap-1.5 rounded-md border-l-[3px] px-1.5 py-1 text-left text-xs leading-tight", t.chip, item.overdue && "border-red-600 bg-red-50 text-red-900")}>
        {item.overdue && <AlertTriangle className="size-3 shrink-0 text-red-600" />}
        {item.time && <span className="shrink-0 font-semibold">{item.time.replace(":00", "").replace(" ", "").toLowerCase()}</span>}
        <span className="truncate">{item.title}</span>
      </span>
    ) : (
      <span className={cn("flex w-full min-w-0 gap-3 rounded-lg border-l-4 px-3 py-2.5 text-left", t.chip, item.overdue && "border-red-600 bg-red-50 text-red-900")}>
        <span className="w-16 shrink-0 text-sm font-semibold sm:w-20">{item.time ?? (item.kind === "job_due" ? "Due" : "All day")}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[15px] font-semibold">{item.title}</span>
            {item.overdue && (
              <span className="inline-flex items-center gap-1 rounded bg-red-600 px-1.5 text-xs font-semibold text-white">
                <AlertTriangle className="size-3" /> Overdue
              </span>
            )}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm opacity-80">
            <span>{t.label}</span>
            {item.endTime && <span>until {item.endTime}</span>}
            {item.subtitle && <span className="min-w-0 truncate">{item.subtitle}</span>}
            {item.locationName && item.kind !== "event" && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" />
                {item.locationName}
              </span>
            )}
          </span>
        </span>
      </span>
    );
  const title = [item.time ?? "All day", item.title, item.subtitle].filter(Boolean).join(" · ");
  if (item.href)
    return (
      <Link href={item.href} title={title} className="block w-full hover:opacity-80">
        {body}
      </Link>
    );
  return (
    <button type="button" title={title} onClick={() => item.event && open(item.event)} className="block w-full hover:opacity-80">
      {body}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Add / edit dialog
// ---------------------------------------------------------------------------
function EventDialog({
  event,
  date,
  canEdit,
  users,
  locations,
  onClose,
}: {
  event: EditableEvent | null;
  date: string;
  canEdit: boolean;
  users: Option[];
  locations: Option[];
  onClose: () => void;
}) {
  const [allDay, setAllDay] = React.useState(event ? event.allDay : false);
  const [pending, start] = React.useTransition();
  const jobNo = useJobNo();

  if (event && !canEdit) {
    // Read-only details for roles without calendar.edit.
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent title={event.title} description={`${EVENT_TYPE_LABELS[event.type]} · ${fmtDate(event.date)}${event.startTime ? " · " + hm12(event.startTime) : ""}`}>
          {event.jobNumber && (
            <p className="mb-2 text-[15px]">
              Job:{" "}
              <Link href={`/jobs/${event.jobNumber}`} className="font-medium text-brand-600 hover:underline">
                {jobNo(event.jobNumber)}
              </Link>
            </p>
          )}
          {event.notes ? <p className="whitespace-pre-wrap text-[15px] text-slate-700">{event.notes}</p> : <p className="text-sm text-slate-500">No notes.</p>}
          <div className="mt-5 flex justify-end">
            <Button onClick={onClose}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (event) fd.set("id", String(event.id));
    start(async () => {
      const r = await saveEvent(fd);
      if (!r.ok) toast.error(r.error);
      else onClose();
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={event ? "Edit event" : "Add reminder or event"} description={event ? undefined : "Job due dates and install/delivery times show up on their own."}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="What" htmlFor="ev-title" required>
            <Input id="ev-title" name="title" defaultValue={event?.title ?? ""} placeholder="e.g. Grimco delivery, Call back Nancy" maxLength={200} required autoFocus={!event} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="ev-type">
              <Select id="ev-type" name="type" defaultValue={event?.type ?? "reminder"}>
                {(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map((t) => (
                  <option key={t} value={t}>
                    {EVENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" htmlFor="ev-date" required>
              <Input id="ev-date" type="date" name="date" defaultValue={event?.date ?? date} required />
            </Field>
          </div>
          <Checkbox name="allDay" label="All day" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          {!allDay && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Start time" htmlFor="ev-start" required>
                <Input id="ev-start" type="time" name="startTime" defaultValue={event?.startTime ?? "09:00"} required step={300} />
              </Field>
              <Field label="End time" htmlFor="ev-end" hint="Optional">
                <Input id="ev-end" type="time" name="endTime" defaultValue={event?.endTime ?? ""} step={300} />
              </Field>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Job number" htmlFor="ev-job" hint="Optional">
              <Input id="ev-job" name="jobNumber" defaultValue={event?.jobNumber ? jobNo(event.jobNumber) : ""} placeholder={jobNo(10428)} />
            </Field>
            <Field label="Where" htmlFor="ev-loc">
              <Select id="ev-loc" name="locationId" defaultValue={event?.locationId ? String(event.locationId) : ""}>
                <option value="">—</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Who" htmlFor="ev-user" hint="Shows under “Only mine”">
              <Select id="ev-user" name="userId" defaultValue={event?.userId ? String(event.userId) : ""}>
                <option value="">Everyone</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Notes" htmlFor="ev-notes">
            <Textarea id="ev-notes" name="notes" defaultValue={event?.notes ?? ""} rows={2} placeholder="Address, phone number, what to bring…" />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {event ? (
              <Confirm
                title="Remove this event?"
                description={`“${event.title}” will be taken off the calendar.`}
                confirmLabel="Remove event"
                onConfirm={async () => {
                  const r = await archiveEvent(event.id);
                  if (!r.ok) toast.error(r.error);
                  else onClose();
                }}
              >
                <Button variant="ghost" className="text-red-600 hover:bg-red-50">
                  Remove
                </Button>
              </Confirm>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {event ? "Save" : "Add to calendar"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
