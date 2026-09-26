/** Task shape shared by <TaskList> (client) and task queries (server). */
export type TaskItem = {
  id: number;
  title: string;
  notes: string | null;
  dueDate: string | null; // YYYY-MM-DD
  completedAt: Date | null;
  createdAt: Date;
  jobId: number | null;
  jobNumber: number | null;
  jobTitle: string | null;
  customerId: number | null;
  customerName: string | null;
  assignedTo: number | null;
  assigneeName: string | null;
  assigneeColor: string | null;
  createdBy: number | null;
  creatorName: string | null;
};

/** People a task can be assigned to. `getActiveUsers()` from lib/lookups fits as-is. */
export type TaskUser = { id: number; name: string; color?: string | null; active?: boolean };
