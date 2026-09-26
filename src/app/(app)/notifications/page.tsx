import type { Metadata } from "next";
import Link from "next/link";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { BellOff, CheckCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifications, users } from "@/lib/db/schema";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import { today, ymdOf } from "@/lib/format";
import { MarkAllReadButton, NotificationList, type NotificationRow } from "./notification-list";

export const metadata: Metadata = { title: "Notifications" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function NotificationsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = sp.tab === "all" ? "all" : "unread";

  const mineOnly = eq(notifications.userId, user.id);
  const [items, [{ unread }]] = await Promise.all([
    db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        title: notifications.title,
        body: notifications.body,
        link: notifications.link,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        actorName: users.name,
        actorColor: users.color,
      })
      .from(notifications)
      .leftJoin(users, eq(users.id, notifications.actorId))
      .where(tab === "unread" ? and(mineOnly, isNull(notifications.readAt)) : mineOnly)
      .orderBy(desc(notifications.createdAt))
      .limit(tab === "unread" ? 200 : 100),
    db.select({ unread: count() }).from(notifications).where(and(mineOnly, isNull(notifications.readAt))),
  ]);

  // Group: Today / Yesterday / Earlier
  const t = today();
  const y = today(-1);
  const groups: { label: string; rows: NotificationRow[] }[] = [
    { label: "Today", rows: [] },
    { label: "Yesterday", rows: [] },
    { label: "Earlier", rows: [] },
  ];
  for (const n of items) {
    const d = ymdOf(n.createdAt);
    groups[d === t ? 0 : d === y ? 1 : 2]!.rows.push(n);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : "You're all caught up"}
        actions={unread > 0 ? <MarkAllReadButton /> : undefined}
      />
      <LinkTabs
        active={tab}
        tabs={[
          { key: "unread", label: "Unread", href: "/notifications", count: unread },
          { key: "all", label: "All", href: "/notifications?tab=all" },
        ]}
      />
      {items.length === 0 ? (
        <Card>
          {tab === "unread" ? (
            <EmptyState
              icon={CheckCheck}
              title="You're all caught up"
              description={
                <>
                  No unread notifications.{" "}
                  <Link href="/notifications?tab=all" className="font-medium text-brand-600 hover:underline">
                    See older ones
                  </Link>
                </>
              }
            />
          ) : (
            <EmptyState icon={BellOff} title="No notifications yet" description="You'll hear about @mentions, tasks given to you, proof approvals and more here." />
          )}
        </Card>
      ) : (
        <div className="space-y-5">
          {groups
            .filter((g) => g.rows.length)
            .map((g) => (
              <section key={g.label}>
                <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.label}</h2>
                <Card className="overflow-hidden">
                  <NotificationList items={g.rows} />
                </Card>
              </section>
            ))}
        </div>
      )}
      <p className="mt-6 text-center text-sm text-slate-500">
        Choose which notifications you get in{" "}
        <Link href="/settings/profile" className="font-medium text-brand-600 hover:underline">
          My profile
        </Link>
        .
      </p>
    </div>
  );
}
