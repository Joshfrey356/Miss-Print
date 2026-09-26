import "server-only";
/**
 * Calendar = job due dates + job fulfillment appointments + custom calendar_events.
 *
 * TODO(google-calendar): two-way sync later. Plan:
 *  - A `CalendarProvider` (like lib/storage, lib/email) with a `google` driver using a service account
 *    or per-user OAuth; `calendar_events.external_id` holds the Google event id.
 *  - Push: after saveEvent/archiveEvent (app/(app)/calendar/actions.ts) upsert/delete the Google event.
 *    Job installs/deliveries (jobs.fulfillment_at) can be pushed the same way, keyed "job-<id>".
 *  - Pull: a periodic job fetches changes (syncToken) and updates rows matched by external_id.
 *  getCalendarItems() below stays the single read path, so the UI doesn't change.
 */
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { aliasedTable } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendarEvents, customers, jobs, locations } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth";
import { fmtTime, jobNo, today } from "@/lib/format";
import { ACTIVE_STATUSES, OPEN_STATUSES, STATUS_SHORT } from "@/lib/jobs/workflow";
import { shopHM, type CalItem, type CalType } from "./types";

const eventJobs = aliasedTable(jobs, "event_job");

const FULFILLMENT_TYPE: Record<string, { type: CalType; label: string; offsite: boolean }> = {
  install: { type: "install", label: "Install", offsite: true },
  delivery: { type: "delivery", label: "Delivery", offsite: true },
  ship: { type: "delivery", label: "Ships", offsite: false },
  pickup: { type: "pickup", label: "Pickup", offsite: false },
};

const minutes = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h! * 60 + m!;
};

/** Everything on the calendar between two shop-time dates (inclusive). */
export async function getCalendarItems({ from, to, user }: { from: string; to: string; user: SessionUser }): Promise<CalItem[]> {
  const localDate = (col: typeof jobs.fulfillmentAt | typeof calendarEvents.startsAt) => sql<string>`to_char(${col} at time zone 'America/Chicago', 'YYYY-MM-DD')`;
  const inRange = (col: typeof jobs.fulfillmentAt | typeof calendarEvents.startsAt) =>
    sql`(${col} at time zone 'America/Chicago')::date between ${from}::date and ${to}::date`;

  const jobCols = {
    id: jobs.id,
    number: jobs.number,
    title: jobs.title,
    status: jobs.status,
    fulfillment: jobs.fulfillment,
    dueDate: jobs.dueDate,
    fulfillmentAt: jobs.fulfillmentAt,
    siteAddress: jobs.siteAddress,
    customer: customers.name,
    locCode: locations.code,
    locName: locations.name,
    salespersonId: jobs.salespersonId,
    designerId: jobs.designerId,
    productionId: jobs.productionId,
    installerId: jobs.installerId,
  };

  const [dueJobs, apptJobs, events, [offsite]] = await Promise.all([
    db
      .select(jobCols)
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .leftJoin(locations, eq(locations.id, jobs.locationId))
      .where(and(isNull(jobs.archivedAt), inArray(jobs.status, OPEN_STATUSES), sql`${jobs.dueDate} between ${from}::date and ${to}::date`)),
    db
      .select({ ...jobCols, localDate: localDate(jobs.fulfillmentAt) })
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .leftJoin(locations, eq(locations.id, jobs.locationId))
      .where(and(isNull(jobs.archivedAt), ne(jobs.status, "cancelled"), inRange(jobs.fulfillmentAt))),
    db
      .select({
        id: calendarEvents.id,
        title: calendarEvents.title,
        type: calendarEvents.type,
        startsAt: calendarEvents.startsAt,
        endsAt: calendarEvents.endsAt,
        allDay: calendarEvents.allDay,
        notes: calendarEvents.notes,
        userId: calendarEvents.userId,
        createdBy: calendarEvents.createdBy,
        locationId: calendarEvents.locationId,
        locCode: locations.code,
        locName: locations.name,
        jobNumber: eventJobs.number,
        jobTitle: eventJobs.title,
        localDate: localDate(calendarEvents.startsAt),
      })
      .from(calendarEvents)
      .leftJoin(locations, eq(locations.id, calendarEvents.locationId))
      .leftJoin(eventJobs, eq(eventJobs.id, calendarEvents.jobId))
      .where(and(isNull(calendarEvents.archivedAt), inRange(calendarEvents.startsAt))),
    db.select({ code: locations.code, name: locations.name }).from(locations).where(eq(locations.code, "OFFSITE")),
  ]);

  const now = today();
  const onJob = (j: (typeof dueJobs)[number]) =>
    [j.salespersonId, j.designerId, j.productionId, j.installerId].includes(user.id);
  const items: CalItem[] = [];

  for (const j of dueJobs) {
    items.push({
      key: `due-${j.id}`,
      kind: "job_due",
      type: "due",
      title: `${jobNo(j.number)} ${j.title}`,
      subtitle: `${j.customer} · ${STATUS_SHORT[j.status]}`,
      date: j.dueDate!,
      time: null,
      endTime: null,
      sort: -1,
      href: `/jobs/${j.number}`,
      jobNumber: j.number,
      overdue: j.dueDate! < now && ACTIVE_STATUSES.includes(j.status),
      mine: onJob(j),
      locationCode: j.locCode,
      locationName: j.locName,
    });
  }

  for (const j of apptJobs) {
    const f = FULFILLMENT_TYPE[j.fulfillment] ?? FULFILLMENT_TYPE.pickup!;
    const hm = shopHM(j.fulfillmentAt!);
    items.push({
      key: `appt-${j.id}`,
      kind: "fulfillment",
      type: f.type,
      title: `${f.label}: ${jobNo(j.number)} ${j.title}`,
      subtitle: [j.customer, f.offsite ? j.siteAddress : null].filter(Boolean).join(" · "),
      date: j.localDate,
      time: fmtTime(j.fulfillmentAt),
      endTime: null,
      sort: minutes(hm),
      href: `/jobs/${j.number}`,
      jobNumber: j.number,
      overdue: false,
      mine: onJob(j),
      locationCode: f.offsite ? (offsite?.code ?? "OFFSITE") : j.locCode,
      locationName: f.offsite ? (offsite?.name ?? "Off-site") : j.locName,
    });
  }

  for (const e of events) {
    const hm = shopHM(e.startsAt);
    items.push({
      key: `event-${e.id}`,
      kind: "event",
      type: e.type as CalType,
      title: e.jobNumber ? `${e.title} (${jobNo(e.jobNumber)})` : e.title,
      subtitle: [e.locName, e.notes].filter(Boolean).join(" · ") || null,
      date: e.localDate,
      time: e.allDay ? null : fmtTime(e.startsAt),
      endTime: e.allDay || !e.endsAt ? null : fmtTime(e.endsAt),
      sort: e.allDay ? -1 : minutes(hm),
      href: null,
      jobNumber: e.jobNumber,
      overdue: false,
      mine: e.userId === user.id || (e.userId == null && e.createdBy === user.id),
      locationCode: e.locCode,
      locationName: e.locName,
      event: {
        id: e.id,
        title: e.title,
        type: e.type,
        date: e.localDate,
        allDay: e.allDay,
        startTime: e.allDay ? null : hm,
        endTime: e.allDay || !e.endsAt ? null : shopHM(e.endsAt),
        jobNumber: e.jobNumber,
        locationId: e.locationId,
        userId: e.userId,
        notes: e.notes,
      },
    });
  }

  // All-day first, then by time; job due dates before custom all-day items.
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.sort - b.sort || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
}
