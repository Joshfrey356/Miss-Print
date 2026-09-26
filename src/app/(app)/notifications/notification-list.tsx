"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AtSign, Bell, CheckCheck, FileCheck, FileText, ListTodo, Receipt, Upload, Clock } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { fmtDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { markAllNotificationsRead, markNotificationRead } from "./actions";

export type NotificationRow = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
  actorName: string | null;
  actorColor: string | null;
};

const ICONS: Record<string, typeof Bell> = {
  mention: AtSign,
  assigned: ListTodo,
  proof: FileCheck,
  quote: FileText,
  artwork: Upload,
  due_soon: Clock,
  invoice: Receipt,
};

export function MarkAllReadButton() {
  const [pending, start] = React.useTransition();
  return (
    <Button onClick={() => start(async () => void (await markAllNotificationsRead()))} disabled={pending}>
      <CheckCheck className="size-4" />
      Mark all read
    </Button>
  );
}

export function NotificationList({ items }: { items: NotificationRow[] }) {
  const router = useRouter();
  const [read, setRead] = React.useState<Set<number>>(new Set());
  const [, start] = React.useTransition();

  const open = (n: NotificationRow) => {
    const unread = !n.readAt && !read.has(n.id);
    if (unread) setRead((s) => new Set(s).add(n.id));
    start(async () => {
      if (unread) await markNotificationRead(n.id);
      if (n.link) router.push(n.link);
    });
  };

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((n) => {
        const unread = !n.readAt && !read.has(n.id);
        const Icon = ICONS[n.kind] ?? Bell;
        return (
          <li key={n.id}>
            <button type="button" onClick={() => open(n)} className={cn("flex w-full gap-3 px-4 py-4 text-left hover:bg-slate-50 sm:px-5", unread && "bg-brand-50/50")}>
              <span className={cn("mt-2 size-2.5 shrink-0 rounded-full", unread ? "bg-brand-500" : "bg-transparent")} aria-label={unread ? "Unread" : undefined} />
              {n.actorName ? (
                <Avatar name={n.actorName} color={n.actorColor} className="size-9" />
              ) : (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                  <Icon className="size-4" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className={cn("block text-[15px] text-slate-900", unread ? "font-semibold" : "font-medium")}>{n.title}</span>
                {n.body && <span className="mt-0.5 line-clamp-2 block text-[15px] text-slate-600">{n.body}</span>}
                <span className="mt-1 block text-sm text-slate-400" title={fmtDateTime(n.createdAt)} suppressHydrationWarning>
                  {timeAgo(n.createdAt)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
