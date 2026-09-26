"use server";
import { refresh } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendarEvents, eventTypeEnum, jobs, locations, users, type EventType } from "@/lib/db/schema";
import { requirePermission } from "@/lib/auth";
import { bool, int, runAction, str, UserError, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/activity";
import { parseJobNumber } from "@/lib/format";
import { isYmd, shopTimeToDate } from "@/lib/calendar/types";

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Create (no id) or update (id) a calendar event.
 * FormData: id?, title, type, date, allDay, startTime, endTime, jobNumber, locationId, userId, notes
 * TODO(google-calendar): push the change to Google here and store its id in externalId.
 */
export async function saveEvent(formData: FormData): Promise<ActionResult<{ id: number }>> {
  return runAction(async () => {
    const user = await requirePermission("calendar.edit");
    const id = int(formData, "id");
    const title = str(formData, "title");
    if (!title) throw new UserError("Give the event a name.");
    if (title.length > 200) throw new UserError("Keep the name under 200 characters. Add details in the notes.");
    const type = (str(formData, "type") ?? "reminder") as EventType;
    if (!eventTypeEnum.enumValues.includes(type)) throw new UserError("Pick a type.");
    const date = str(formData, "date");
    if (!isYmd(date)) throw new UserError("Pick a date.");
    const allDay = bool(formData, "allDay");
    const startTime = str(formData, "startTime");
    const endTime = str(formData, "endTime");
    if (!allDay && (!startTime || !HM.test(startTime))) throw new UserError("Pick a start time, or check “All day”.");
    if (!allDay && endTime && !HM.test(endTime)) throw new UserError("That end time doesn't look right.");
    if (!allDay && endTime && startTime && endTime <= startTime) throw new UserError("The end time must be after the start time.");

    const startsAt = shopTimeToDate(date, allDay ? "00:00" : startTime!);
    const endsAt = !allDay && endTime ? shopTimeToDate(date, endTime) : null;

    let jobId: number | null = null;
    let customerId: number | null = null;
    const jobRaw = str(formData, "jobNumber");
    if (jobRaw) {
      const n = parseJobNumber(jobRaw);
      const [j] = n ? await db
            .select({ id: jobs.id, customerId: jobs.customerId })
            .from(jobs)
            .where(and(eq(jobs.tenantId, user.tenantId), eq(jobs.number, n), isNull(jobs.archivedAt))) : [];
      if (!j) throw new UserError(`There's no job ${jobRaw}. Check the number, or leave it blank.`);
      jobId = j.id;
      customerId = j.customerId;
    }
    let locationId = int(formData, "locationId");
    if (locationId) {
      const [l] = await db
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.tenantId, user.tenantId), eq(locations.id, locationId)));
      locationId = l?.id ?? null;
    }
    let userId = int(formData, "userId");
    if (userId) {
      const [u] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, user.tenantId), eq(users.id, userId)));
      userId = u?.id ?? null;
    }
    const values = { title, type, startsAt, endsAt, allDay, jobId, locationId, userId, notes: str(formData, "notes") };

    const savedId = await db.transaction(async (tx) => {
      if (id) {
        const [row] = await tx
          .update(calendarEvents)
          .set(values)
          .where(and(eq(calendarEvents.tenantId, user.tenantId), eq(calendarEvents.id, id), isNull(calendarEvents.archivedAt)))
          .returning({ id: calendarEvents.id });
        if (!row) throw new UserError("That event was not found. It may have been removed.");
        return row.id;
      }
      const [row] = await tx.insert(calendarEvents).values({ ...values, tenantId: user.tenantId, createdBy: user.id }).returning({ id: calendarEvents.id });
      if (jobId)
        await logActivity(
          { tenantId: user.tenantId, action: "calendar.event_added", entityType: "job", entityId: jobId, jobId, customerId, actorId: user.id, summary: `Added “${title}” to the calendar`, data: { date, startTime: allDay ? null : startTime } },
          tx,
        );
      return row!.id;
    });
    refresh();
    return { id: savedId };
  });
}

/** Remove an event from the calendar (archived). */
export async function archiveEvent(id: number): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("calendar.edit");
    await db
      .update(calendarEvents)
      .set({ archivedAt: new Date() })
      .where(and(eq(calendarEvents.tenantId, user.tenantId), eq(calendarEvents.id, id)));
    refresh();
  }, "Event removed");
}
