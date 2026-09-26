import "server-only";
import { aliasedTable, and, asc, desc, eq, gt, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, jobs, tasks, users } from "@/lib/db/schema";
import type { TaskItem } from "./types";

export type { TaskItem, TaskUser } from "./types";

const assignee = aliasedTable(users, "assignee");
const creator = aliasedTable(users, "creator");

const taskSelect = {
  id: tasks.id,
  title: tasks.title,
  notes: tasks.notes,
  dueDate: tasks.dueDate,
  completedAt: tasks.completedAt,
  createdAt: tasks.createdAt,
  jobId: tasks.jobId,
  jobNumber: jobs.number,
  jobTitle: jobs.title,
  customerId: sql<number | null>`coalesce(${tasks.customerId}, ${jobs.customerId})`,
  customerName: customers.name,
  assignedTo: tasks.assignedTo,
  assigneeName: assignee.name,
  assigneeColor: assignee.color,
  createdBy: tasks.createdBy,
  creatorName: creator.name,
};

// Overdue → today → upcoming (earliest first) → no date.
const openOrder = [sql`${tasks.dueDate} is null`, asc(tasks.dueDate), asc(tasks.createdAt)];

function listTasks(where: SQL | undefined, order: SQL[] = openOrder, limit = 200): Promise<TaskItem[]> {
  return db
    .select(taskSelect)
    .from(tasks)
    .leftJoin(jobs, eq(jobs.id, tasks.jobId))
    .leftJoin(customers, sql`${customers.id} = coalesce(${tasks.customerId}, ${jobs.customerId})`)
    .leftJoin(assignee, eq(assignee.id, tasks.assignedTo))
    .leftJoin(creator, eq(creator.id, tasks.createdBy))
    .where(and(isNull(tasks.archivedAt), where))
    .orderBy(...order)
    .limit(limit);
}

const open = isNull(tasks.completedAt);

/** My open tasks: overdue first, then today, upcoming, and tasks with no date. */
export function getMyTasks(userId: number): Promise<TaskItem[]> {
  return listTasks(and(open, eq(tasks.assignedTo, userId)));
}

/**
 * Tasks on a job or customer: open ones first (by due date), then the 20 most recently completed.
 */
export async function getTasksFor({ jobId, customerId }: { jobId?: number | null; customerId?: number | null }): Promise<TaskItem[]> {
  const scope = jobId ? eq(tasks.jobId, jobId) : customerId ? or(eq(tasks.customerId, customerId), eq(jobs.customerId, customerId)) : undefined;
  if (!scope) return [];
  const [openRows, doneRows] = await Promise.all([
    listTasks(and(open, scope)),
    listTasks(and(isNotNull(tasks.completedAt), scope), [desc(tasks.completedAt)], 20),
  ]);
  return [...openRows, ...doneRows];
}

/** Open tasks I gave to other people. */
export function getTasksAssignedBy(userId: number): Promise<TaskItem[]> {
  return listTasks(and(open, eq(tasks.createdBy, userId), or(isNull(tasks.assignedTo), ne(tasks.assignedTo, userId))));
}

/** Every open task in the shop (owner/manager view). */
export function getAllOpenTasks(): Promise<TaskItem[]> {
  return listTasks(open, openOrder, 500);
}

/** Recently completed tasks (last 30 days) — mine and ones I created, or everyone's for managers. */
export function getCompletedTasks(userId: number, everyone: boolean): Promise<TaskItem[]> {
  const since = new Date(Date.now() - 30 * 86400000);
  const mine = everyone ? undefined : or(eq(tasks.assignedTo, userId), eq(tasks.createdBy, userId));
  return listTasks(and(isNotNull(tasks.completedAt), gt(tasks.completedAt, since), mine), [desc(tasks.completedAt)], 200);
}

/** Count of my open tasks that are due today or overdue (for badges). */
export async function countMyDueTasks(userId: number, todayYmd: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(isNull(tasks.archivedAt), open, eq(tasks.assignedTo, userId), sql`${tasks.dueDate} <= ${todayYmd}`));
  return row?.n ?? 0;
}
