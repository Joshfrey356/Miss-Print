import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth";
import { getActiveUsers } from "@/lib/lookups";
import { getAllOpenTasks, getCompletedTasks, getMyTasks, getTasksAssignedBy } from "@/lib/tasks/queries";
import { TaskList } from "@/components/tasks/task-list";
import { PageHeader } from "@/components/ui/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { plural, today } from "@/lib/format";

export const metadata: Metadata = { title: "Tasks" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function TasksPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePagePermission("tasks.use");
  const sp = await searchParams;
  const isManager = user.role === "owner" || user.role === "manager";
  const tabKeys = ["mine", "assigned", ...(isManager ? ["all"] : []), "done"];
  const tab = typeof sp.tab === "string" && tabKeys.includes(sp.tab) ? sp.tab : "mine";

  const [users, mine, list] = await Promise.all([
    getActiveUsers(),
    getMyTasks(user.id),
    tab === "assigned"
      ? getTasksAssignedBy(user.id)
      : tab === "all"
        ? getAllOpenTasks()
        : tab === "done"
          ? getCompletedTasks(user.id, isManager)
          : null,
  ]);
  const tasks = list ?? mine;
  const t = today();
  const overdue = mine.filter((x) => x.dueDate && x.dueDate < t).length;
  const dueToday = mine.filter((x) => x.dueDate === t).length;

  const tabs = [
    { key: "mine", label: "My tasks", href: "/tasks", count: mine.length },
    { key: "assigned", label: "Assigned by me", href: "/tasks?tab=assigned" },
    ...(isManager ? [{ key: "all", label: "All open", href: "/tasks?tab=all" }] : []),
    { key: "done", label: "Completed", href: "/tasks?tab=done" },
  ];

  const empty: Record<string, string> = {
    mine: "You have no open tasks",
    assigned: "You haven't given anyone a task",
    all: "Nobody has open tasks",
    done: "No tasks were completed in the last 30 days",
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Tasks"
        subtitle={
          tab === "mine"
            ? overdue || dueToday
              ? [overdue && `${plural(overdue, "task")} overdue`, dueToday && `${dueToday} due today`].filter(Boolean).join(" · ")
              : "Quick to-dos for you and the team. Tap the circle when it's done."
            : tab === "done"
              ? "Finished in the last 30 days"
              : "Open tasks, soonest due first"
        }
      />
      <LinkTabs tabs={tabs} active={tab} />
      <Card className="px-3 py-2 sm:px-5 sm:py-3">
        <TaskList
          key={tab}
          tasks={tasks}
          users={users}
          showAdd={tab === "mine" || tab === "assigned"}
          hideAssignee={tab === "mine"}
          emptyText={empty[tab]}
        />
      </Card>
    </div>
  );
}
