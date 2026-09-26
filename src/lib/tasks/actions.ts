"use server";
import { refresh } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, jobs, tasks, users } from "@/lib/db/schema";
import { ForbiddenError, requirePermission, type SessionUser } from "@/lib/auth";
import { int, runAction, str, UserError, type ActionResult } from "@/lib/actions";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notifications";
import { jobNo } from "@/lib/format";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function parseDue(fd: FormData) {
  const v = str(fd, "dueDate");
  if (!v) return null;
  if (!YMD.test(v) || Number.isNaN(Date.parse(v))) throw new UserError("Please pick a valid due date.");
  return v;
}

/** "me" / blank → the current user; otherwise an active user id. */
async function parseAssignee(fd: FormData, user: SessionUser) {
  const raw = str(fd, "assignedTo");
  if (!raw || raw === "me") return user.id;
  const id = Number(raw);
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, user.tenantId), eq(users.id, id), eq(users.active, true)));
  if (!u) throw new UserError("Pick who this task is for.");
  return u.id;
}

async function loadJob(tenantId: number, jobId: number | null) {
  if (!jobId) return null;
  const [j] = await db
    .select({ id: jobs.id, number: jobs.number, customerId: jobs.customerId })
    .from(jobs)
    .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, jobId), isNull(jobs.archivedAt)));
  if (!j) throw new UserError("That job was not found.");
  return j;
}

const taskLink = (job: { number: number } | null) => (job ? `/jobs/${job.number}?tab=tasks` : "/tasks");

async function loadTask(tenantId: number, id: number) {
  const [t] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), eq(tasks.id, id), isNull(tasks.archivedAt)));
  if (!t) throw new UserError("That task was not found. It may have been removed.");
  return t;
}

/** FormData: title, assignedTo ("me" | user id), dueDate (YYYY-MM-DD), notes, jobId, customerId */
export async function createTask(formData: FormData): Promise<ActionResult<{ id: number }>> {
  return runAction(async () => {
    const user = await requirePermission("tasks.use");
    const title = str(formData, "title");
    if (!title) throw new UserError("Type what needs to be done.");
    if (title.length > 200) throw new UserError("Keep the task under 200 characters. Add details in the notes.");
    const assignedTo = await parseAssignee(formData, user);
    const dueDate = parseDue(formData);
    const job = await loadJob(user.tenantId, int(formData, "jobId"));
    let customerId = int(formData, "customerId") ?? job?.customerId ?? null;
    if (customerId && !job) {
      const [c] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.tenantId, user.tenantId), eq(customers.id, customerId)));
      if (!c) customerId = null;
    }

    const id = await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(tasks)
        .values({ tenantId: user.tenantId, title, notes: str(formData, "notes"), jobId: job?.id ?? null, customerId, assignedTo, dueDate, createdBy: user.id })
        .returning({ id: tasks.id });
      if (job)
        await logActivity(
          { tenantId: user.tenantId, action: "task.created", entityType: "task", entityId: t!.id, jobId: job.id, customerId: job.customerId, actorId: user.id, summary: `Added task “${title}”`, data: { assignedTo, dueDate } },
          tx,
        );
      if (assignedTo !== user.id)
        await notify(
          {
            tenantId: user.tenantId,
            userIds: [assignedTo],
            kind: "assigned",
            title: `${user.name.split(" ")[0]} gave you a task${job ? ` on ${jobNo(job.number)}` : ""}`,
            body: title,
            link: taskLink(job),
            actorId: user.id,
          },
          tx,
        );
      return t!.id;
    });
    refresh();
    return { id };
  });
}

/** Check a task off (done = true) or reopen it. */
export async function toggleTask(id: number, done: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("tasks.use");
    const t = await loadTask(user.tenantId, id);
    if (Boolean(t.completedAt) === done) return;
    await db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set(done ? { completedAt: new Date(), completedBy: user.id } : { completedAt: null, completedBy: null })
        .where(and(eq(tasks.tenantId, user.tenantId), eq(tasks.id, id)));
      if (t.jobId)
        await logActivity(
          {
            tenantId: user.tenantId,
            action: done ? "task.completed" : "task.reopened",
            entityType: "task",
            entityId: id,
            jobId: t.jobId,
            customerId: t.customerId,
            actorId: user.id,
            summary: done ? `Completed task “${t.title}”` : `Reopened task “${t.title}”`,
          },
          tx,
        );
    });
    refresh();
  });
}

/** FormData: id, title, notes, assignedTo, dueDate */
export async function updateTask(formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("tasks.use");
    const t = await loadTask(user.tenantId, int(formData, "id") ?? 0);
    const title = str(formData, "title");
    if (!title) throw new UserError("The task needs a title.");
    if (title.length > 200) throw new UserError("Keep the task under 200 characters. Add details in the notes.");
    const assignedTo = await parseAssignee(formData, user);
    const dueDate = parseDue(formData);
    const notes = str(formData, "notes");

    await db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({ title, notes, assignedTo, dueDate })
        .where(and(eq(tasks.tenantId, user.tenantId), eq(tasks.id, t.id)));
      const reassigned = assignedTo !== t.assignedTo;
      if (t.jobId && (reassigned || dueDate !== t.dueDate))
        await logActivity(
          {
            tenantId: user.tenantId,
            action: "task.updated",
            entityType: "task",
            entityId: t.id,
            jobId: t.jobId,
            customerId: t.customerId,
            actorId: user.id,
            summary: reassigned ? `Reassigned task “${title}”` : `Changed due date of “${title}”`,
            data: { before: { assignedTo: t.assignedTo, dueDate: t.dueDate }, after: { assignedTo, dueDate } },
          },
          tx,
        );
      if (reassigned && assignedTo !== user.id) {
        const [j] = t.jobId ? await tx.select({ number: jobs.number }).from(jobs).where(and(eq(jobs.tenantId, user.tenantId), eq(jobs.id, t.jobId))) : [];
        await notify(
          {
            tenantId: user.tenantId,
            userIds: [assignedTo],
            kind: "assigned",
            title: `${user.name.split(" ")[0]} gave you a task${j ? ` on ${jobNo(j.number)}` : ""}`,
            body: title,
            link: taskLink(j ?? null),
            actorId: user.id,
          },
          tx,
        );
      }
    });
    refresh();
  });
}

/** Remove a task (archived, never hard-deleted). Allowed for its creator, assignee, owner and managers. */
export async function archiveTask(id: number): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission("tasks.use");
    const t = await loadTask(user.tenantId, id);
    const allowed = t.createdBy === user.id || t.assignedTo === user.id || user.role === "owner" || user.role === "manager";
    if (!allowed) throw new ForbiddenError("Only the person who made this task (or a manager) can remove it.");
    await db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({ archivedAt: new Date() })
        .where(and(eq(tasks.tenantId, user.tenantId), eq(tasks.id, id)));
      if (t.jobId)
        await logActivity(
          { tenantId: user.tenantId, action: "task.removed", entityType: "task", entityId: id, jobId: t.jobId, customerId: t.customerId, actorId: user.id, summary: `Removed task “${t.title}”` },
          tx,
        );
    });
    refresh();
  }, "Task removed");
}
