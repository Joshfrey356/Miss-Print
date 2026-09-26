"use client";
import * as React from "react";
import Link from "next/link";
import { Check, ListTodo, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { archiveTask, createTask, toggleTask, updateTask } from "@/lib/tasks/actions";
import type { TaskItem, TaskUser } from "@/lib/tasks/types";
import { addDays, daysBetween, dueLabel, fmtDate, jobNo, today } from "@/lib/format";
import { cn } from "@/lib/utils";

export type { TaskItem, TaskUser } from "@/lib/tasks/types";

/**
 * A simple checklist of tasks with an inline "Add task" row.
 *
 *   Dashboard:  <TaskList tasks={await getMyTasks(user.id)} users={await getActiveUsers()} compact />
 *   Job page:   <TaskList tasks={await getTasksFor({ jobId: job.id })} users={users} jobId={job.id} />
 *
 * On a job/customer page, new tasks are attached to that job/customer and the job link is hidden.
 */
export function TaskList({
  tasks,
  users,
  jobId,
  customerId,
  compact,
  showAdd = true,
  emptyText,
  hideAssignee,
}: {
  tasks: TaskItem[];
  users: TaskUser[];
  jobId?: number;
  customerId?: number;
  compact?: boolean;
  showAdd?: boolean;
  emptyText?: string;
  /** Hide the assignee on each row (e.g. "My tasks" where it's always you). */
  hideAssignee?: boolean;
}) {
  // Optimistic check-off. Tasks checked off here stay visible (struck through) until the page is left,
  // so an accidental tap is easy to undo even after the list refreshes.
  const [local, setLocal] = React.useState<Record<number, { done: boolean; task: TaskItem }>>({});
  const [editing, setEditing] = React.useState<TaskItem | null>(null);

  const rows = React.useMemo(() => {
    const ids = new Set(tasks.map((t) => t.id));
    const merged = tasks.map((t) => (local[t.id] ? { ...t, completedAt: local[t.id]!.done ? (t.completedAt ?? new Date()) : null } : t));
    const gone = Object.values(local)
      .filter((l) => !ids.has(l.task.id))
      .map((l) => ({ ...l.task, completedAt: l.done ? (l.task.completedAt ?? new Date()) : null }));
    return [...merged, ...gone];
  }, [tasks, local]);

  const toggle = async (t: TaskItem) => {
    const done = !t.completedAt;
    setLocal((s) => ({ ...s, [t.id]: { done, task: t } }));
    const r = await toggleTask(t.id, done);
    if (!r.ok) {
      toast.error(r.error);
      setLocal((s) => ({ ...s, [t.id]: { done: !done, task: t } }));
    }
  };

  const showJob = !jobId;
  const showCustomer = !jobId && !customerId;

  return (
    <div>
      {rows.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          compact
          title={emptyText ?? (jobId ? "No tasks on this job" : "No open tasks")}
          description={showAdd ? "Add one below — for example “Call customer about proof”." : undefined}
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((t) => (
            <TaskRow
              key={t.id}
              t={t}
              compact={compact}
              showJob={showJob}
              showCustomer={showCustomer}
              showAssignee={!hideAssignee}
              onToggle={() => toggle(t)}
              onEdit={() => setEditing(t)}
            />
          ))}
        </ul>
      )}
      {showAdd && <AddTaskRow users={users} jobId={jobId} customerId={customerId} compact={compact} />}
      <EditTaskDialog
        task={editing}
        users={users}
        onClose={() => setEditing(null)}
        onRemoved={(id) =>
          setLocal((s) => {
            const { [id]: _removed, ...rest } = s;
            return rest;
          })
        }
      />
    </div>
  );
}

function TaskRow({
  t,
  compact,
  showJob,
  showCustomer,
  showAssignee,
  onToggle,
  onEdit,
}: {
  t: TaskItem;
  compact?: boolean;
  showJob: boolean;
  showCustomer: boolean;
  showAssignee: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const done = Boolean(t.completedAt);
  const now = today();
  const diff = t.dueDate ? daysBetween(now, t.dueDate) : null;
  const overdue = !done && diff != null && diff < 0;
  const dueToday = !done && diff === 0;
  return (
    <li className={cn("flex items-start gap-2", compact ? "py-1.5" : "py-2.5")}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark “${t.title}” not done` : `Mark “${t.title}” done`}
        onClick={onToggle}
        className="-m-1 flex size-11 shrink-0 items-center justify-center rounded-full"
      >
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-full border-2 transition-colors",
            done ? "border-emerald-500 bg-emerald-500 text-white" : overdue ? "border-red-400 hover:bg-red-50" : "border-slate-300 hover:border-brand-500 hover:bg-brand-50",
          )}
        >
          {done && <Check className="size-4" strokeWidth={3} />}
        </span>
      </button>
      <div className="min-w-0 flex-1 pt-2">
        <button type="button" onClick={onEdit} className={cn("block text-left text-[15px] leading-snug", done ? "text-slate-400 line-through" : "text-slate-900 hover:text-brand-700")}>
          {t.title}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
          {!done && t.dueDate && (
            <span className={cn(overdue && "font-semibold text-red-600", dueToday && "font-semibold text-amber-700")} title={fmtDate(t.dueDate, { year: true })} suppressHydrationWarning>
              {overdue ? `Overdue · ${dueLabel(t.dueDate, now)}` : dueLabel(t.dueDate, now)}
            </span>
          )}
          {done && <span>Done</span>}
          {showJob && t.jobNumber && (
            <Link href={`/jobs/${t.jobNumber}?tab=tasks`} className="font-medium text-brand-600 hover:underline" title={t.jobTitle ?? undefined}>
              {jobNo(t.jobNumber)}
              {!compact && t.jobTitle && <span className="font-normal text-slate-500"> · {t.jobTitle}</span>}
            </Link>
          )}
          {showCustomer && t.customerName && (!compact || !t.jobNumber) && (
            <Link href={`/customers/${t.customerId}`} className="truncate hover:text-slate-800 hover:underline">
              {t.customerName}
            </Link>
          )}
          {showAssignee && t.assigneeName && (
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={t.assigneeName} color={t.assigneeColor} size="sm" className="size-5 text-[9px]" />
              {t.assigneeName.split(" ")[0]}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Add task
// ---------------------------------------------------------------------------
type DueChoice = "none" | "today" | "tomorrow" | "pick";

function DuePicker({ choice, date, onChange }: { choice: DueChoice; date: string; onChange: (c: DueChoice, date: string) => void }) {
  const opts: { key: DueChoice; label: string }[] = [
    { key: "none", label: "No date" },
    { key: "today", label: "Today" },
    { key: "tomorrow", label: "Tomorrow" },
    { key: "pick", label: "Pick date" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key, o.key === "pick" ? date || addDays(today(), 2) : date)}
          className={cn(
            "h-9 rounded-full border px-3 text-sm font-medium",
            choice === o.key ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
          )}
        >
          {o.label}
        </button>
      ))}
      {choice === "pick" && (
        <Input type="date" aria-label="Due date" value={date} min={today(-365)} onChange={(e) => onChange("pick", e.target.value)} className="h-9 w-auto" />
      )}
    </div>
  );
}

const dueFor = (choice: DueChoice, date: string) => (choice === "today" ? today() : choice === "tomorrow" ? today(1) : choice === "pick" ? date : "");

function AddTaskRow({ users, jobId, customerId, compact }: { users: TaskUser[]; jobId?: number; customerId?: number; compact?: boolean }) {
  const [title, setTitle] = React.useState("");
  const [assignedTo, setAssignedTo] = React.useState("me");
  const [due, setDue] = React.useState<DueChoice>("none");
  const [date, setDate] = React.useState("");
  const [open, setOpen] = React.useState(!compact);
  const [pending, start] = React.useTransition();
  const input = React.useRef<HTMLInputElement>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || pending) return;
    const fd = new FormData();
    fd.set("title", title.trim());
    fd.set("assignedTo", assignedTo);
    fd.set("dueDate", dueFor(due, date));
    if (jobId) fd.set("jobId", String(jobId));
    if (customerId) fd.set("customerId", String(customerId));
    start(async () => {
      const r = await createTask(fd);
      if (!r.ok) toast.error(r.error);
      else {
        setTitle("");
        input.current?.focus();
      }
    });
  };

  return (
    <form onSubmit={submit} className={cn("mt-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-2.5", open && "border-solid bg-white")}>
      <div className="flex items-center gap-2">
        <Plus className="ml-1 size-5 shrink-0 text-slate-400" />
        <input
          ref={input}
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Add a task…"
          aria-label="New task"
          className="h-10 min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400 focus-visible:outline-none sm:text-[15px]"
        />
        {(!open || compact) && (
          <Button type="submit" variant="primary" size="sm" disabled={!title.trim() || pending} className={cn(!title.trim() && "hidden")}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : "Add"}
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5">
          <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} aria-label="Assign to" className="h-9 w-auto min-w-36 text-sm">
            <option value="me">For me</option>
            {users
              .filter((u) => u.active !== false)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  For {u.name}
                </option>
              ))}
          </Select>
          <DuePicker
            choice={due}
            date={date}
            onChange={(c, d) => {
              setDue(c);
              setDate(d);
            }}
          />
          {!compact && (
            <Button type="submit" variant="primary" size="sm" disabled={!title.trim() || pending} className="ml-auto h-9">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add task
            </Button>
          )}
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Edit task
// ---------------------------------------------------------------------------
function EditTaskDialog({ task, users, onClose, onRemoved }: { task: TaskItem | null; users: TaskUser[]; onClose: () => void; onRemoved: (id: number) => void }) {
  const [pending, start] = React.useTransition();
  if (!task) return null;
  const save = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("id", String(task.id));
    start(async () => {
      const r = await updateTask(fd);
      if (!r.ok) toast.error(r.error);
      else onClose();
    });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Edit task" description={task.creatorName ? `Added by ${task.creatorName}` : undefined}>
        <form onSubmit={save} className="space-y-4">
          <Field label="What needs to be done" htmlFor="task-title" required>
            <Input id="task-title" name="title" defaultValue={task.title} maxLength={200} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="For" htmlFor="task-assignee">
              <Select id="task-assignee" name="assignedTo" defaultValue={task.assignedTo ? String(task.assignedTo) : "me"}>
                {users
                  .filter((u) => u.active !== false || u.id === task.assignedTo)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Due date" htmlFor="task-due" hint="Leave blank for no date">
              <Input id="task-due" type="date" name="dueDate" defaultValue={task.dueDate ?? ""} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="task-notes">
            <Textarea id="task-notes" name="notes" defaultValue={task.notes ?? ""} rows={3} placeholder="Details, phone numbers…" />
          </Field>
          {task.jobNumber && (
            <p className="text-sm text-slate-500">
              On job{" "}
              <Link href={`/jobs/${task.jobNumber}`} className="font-medium text-brand-600 hover:underline">
                {jobNo(task.jobNumber)} {task.jobTitle}
              </Link>
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <Confirm
              title="Remove this task?"
              description={`“${task.title}” will be removed from everyone's list.`}
              confirmLabel="Remove task"
              onConfirm={async () => {
                const r = await archiveTask(task.id);
                if (!r.ok) toast.error(r.error);
                else {
                  onRemoved(task.id);
                  onClose();
                }
              }}
            >
              <Button variant="ghost" className="text-red-600 hover:bg-red-50">
                Remove task
              </Button>
            </Confirm>
            <div className="flex gap-2">
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
