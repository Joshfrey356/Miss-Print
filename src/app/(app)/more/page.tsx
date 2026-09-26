import type { Metadata } from "next";
import Link from "next/link";
import { and, count, eq, isNull } from "drizzle-orm";
import {
  BarChart3,
  Bell,
  BookOpen,
  Briefcase,
  CalendarDays,
  ChevronRight,
  DollarSign,
  FileText,
  ListTodo,
  LogOut,
  MessageSquare,
  Settings,
  SlidersHorizontal,
  Tv,
  Users,
  type LucideIcon,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { can, ROLE_LABELS, type Permission } from "@/lib/permissions";
import { countMyDueTasks } from "@/lib/tasks/queries";
import { today } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { logoutAction } from "@/app/(auth)/login/actions";

export const metadata: Metadata = { title: "More" };

type Tile = { href: string; label: string; hint: string; icon: LucideIcon; perm?: Permission; badge?: number; tone: string };

/** Phone "More" tab: everything that isn't in the bottom tab bar, as big tappable tiles. */
export default async function MorePage() {
  const user = await requireUser();
  const [[{ unread }], dueTasks] = await Promise.all([
    db
      .select({ unread: count() })
      .from(notifications)
      .where(and(eq(notifications.tenantId, user.tenantId), eq(notifications.userId, user.id), isNull(notifications.readAt))),
    can(user.role, "tasks.use") ? countMyDueTasks(user.tenantId, user.id, today()) : Promise.resolve(0),
  ]);

  const tiles: Tile[] = [
    { href: "/tasks", label: "Tasks", hint: dueTasks ? `${dueTasks} due today or late` : "My to-do list", icon: ListTodo, perm: "tasks.use", badge: dueTasks, tone: "bg-emerald-50 text-emerald-600" },
    { href: "/notifications", label: "Notifications", hint: unread ? `${unread} unread` : "All caught up", icon: Bell, badge: unread, tone: "bg-red-50 text-red-600" },
    { href: "/quotes", label: "Quotes", hint: "Prices for customers", icon: FileText, perm: "quotes.view", tone: "bg-violet-50 text-violet-600" },
    { href: "/customers", label: "Customers", hint: "Contacts & history", icon: Users, perm: "customers.view", tone: "bg-sky-50 text-sky-600" },
    { href: "/money", label: "Money", hint: "Invoices & payments", icon: DollarSign, perm: "money.view", tone: "bg-green-50 text-green-700" },
    { href: "/reports", label: "Reports", hint: "How we're doing", icon: BarChart3, perm: "reports.basic", tone: "bg-orange-50 text-orange-600" },
    { href: "/knowledge", label: "Knowledge", hint: "How-tos & checklists", icon: BookOpen, tone: "bg-amber-50 text-amber-700" },
    { href: "/tv", label: "Production TV", hint: "Shop-floor screen", icon: Tv, perm: "jobs.view", tone: "bg-slate-100 text-slate-700" },
    { href: "/settings/profile", label: "My profile", hint: "Password & notifications", icon: SlidersHorizontal, tone: "bg-brand-50 text-brand-600" },
    { href: "/settings", label: "Settings", hint: "Business rules & team", icon: Settings, perm: "settings.manage", tone: "bg-slate-100 text-slate-700" },
  ];
  const visible = tiles.filter((t) => !t.perm || can(user.role, t.perm));

  // Main sections too, so desktop/tablet users landing here can still get anywhere.
  const main = [
    { href: "/jobs", label: "Jobs", icon: Briefcase, perm: "jobs.view" as Permission },
    { href: "/calendar", label: "Calendar", icon: CalendarDays, perm: "calendar.view" as Permission },
    { href: "/messages", label: "Messages", icon: MessageSquare, perm: "messages.use" as Permission },
  ].filter((m) => can(user.role, m.perm));

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <Avatar name={user.name} color={user.color} size="lg" className="size-14 text-lg" />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-slate-900">{user.name}</p>
          <p className="truncate text-[15px] text-slate-500">{user.title ?? ROLE_LABELS[user.role]}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {visible.map((t) => (
          <Link key={t.href} href={t.href} className="relative flex min-h-32 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm active:bg-slate-50 hover:border-slate-300">
            <span className={`flex size-11 items-center justify-center rounded-xl ${t.tone}`}>
              <t.icon className="size-6" />
            </span>
            <span>
              <span className="block text-base font-semibold text-slate-900">{t.label}</span>
              <span className="block text-sm leading-snug text-slate-500">{t.hint}</span>
            </span>
            {t.badge ? (
              <span className="absolute right-3 top-3 min-w-6 rounded-full bg-red-500 px-1.5 text-center text-sm font-bold leading-6 text-white">{t.badge > 99 ? "99+" : t.badge}</span>
            ) : null}
          </Link>
        ))}
      </div>

      {main.length > 0 && (
        <div className="mt-6 hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:block">
          {main.map((m) => (
            <Link key={m.href} href={m.href} className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5 text-[15px] font-medium text-slate-800 last:border-0 hover:bg-slate-50">
              <m.icon className="size-5 text-slate-400" />
              <span className="flex-1">{m.label}</span>
              <ChevronRight className="size-4 text-slate-300" />
            </Link>
          ))}
        </div>
      )}

      <form action={logoutAction} className="mt-6">
        <button type="submit" className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-base font-semibold text-red-600 shadow-sm hover:bg-red-50">
          <LogOut className="size-5" />
          Sign out
        </button>
      </form>
    </div>
  );
}
