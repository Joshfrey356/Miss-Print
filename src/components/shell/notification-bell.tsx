"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { Dropdown, DropdownContent, DropdownTrigger } from "@/components/ui/dropdown";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

type N = { id: number; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<N[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/notifications");
    if (!res.ok) return;
    const json = (await res.json()) as { unread: number; items: N[] };
    setUnread(json.unread);
    setItems(json.items);
  }, []);

  // Refresh the count when navigating (e.g. after reading notifications) and when the server count changes.
  const pathname = usePathname();
  useEffect(() => {
    setUnread(initialUnread);
  }, [initialUnread]);
  useEffect(() => {
    load();
  }, [pathname, load]);

  // Light polling — once a minute, only while the tab is visible.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && load(), 60000);
    return () => clearInterval(t);
  }, [load]);

  const markAll = async () => {
    await fetch("/api/notifications", { method: "POST", body: JSON.stringify({ all: true }) });
    load();
  };
  const open = async (n: N) => {
    if (!n.readAt) await fetch("/api/notifications", { method: "POST", body: JSON.stringify({ id: n.id }) });
    if (n.link) router.push(n.link);
    load();
  };

  return (
    <Dropdown onOpenChange={(o) => o && load()}>
      <DropdownTrigger asChild>
        <button aria-label={`Notifications (${unread} unread)`} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-4 text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </DropdownTrigger>
      <DropdownContent className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <span className="font-semibold text-slate-900">Notifications</span>
          {unread > 0 && (
            <button onClick={markAll} className="flex items-center gap-1 text-sm text-brand-600 hover:underline">
              <CheckCheck className="size-4" /> Mark all read
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {items === null && <p className="px-4 py-6 text-sm text-slate-500">Loading…</p>}
          {items?.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">You’re all caught up.</p>}
          {items?.map((n) => (
            <button
              key={n.id}
              onClick={() => open(n)}
              className={cn("flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50", !n.readAt && "bg-brand-50/50")}
            >
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand-500")} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-800">{n.title}</span>
                {n.body && <span className="mt-0.5 line-clamp-2 block text-sm text-slate-500">{n.body}</span>}
                <span className="mt-1 block text-xs text-slate-400">{timeAgo(n.createdAt)}</span>
              </span>
            </button>
          ))}
        </div>
        <Link href="/notifications" className="block border-t border-slate-100 px-4 py-2.5 text-center text-sm font-medium text-brand-600 hover:bg-slate-50">
          See all
        </Link>
      </DropdownContent>
    </Dropdown>
  );
}
