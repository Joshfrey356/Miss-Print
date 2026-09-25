import { and, count, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { Logo } from "@/components/logo";
import { MobileTabBar, SidebarNav, type NavKey } from "@/components/shell/nav";
import { NewMenu } from "@/components/shell/new-menu";
import { SearchButton } from "@/components/shell/command-palette";
import { NotificationBell } from "@/components/shell/notification-bell";
import { UserMenu } from "@/components/shell/user-menu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const r = user.role;
  const allowed: NavKey[] = ["dashboard"];
  if (can(r, "jobs.view")) allowed.push("jobs");
  if (can(r, "quotes.view")) allowed.push("quotes");
  if (can(r, "customers.view")) allowed.push("customers");
  if (can(r, "calendar.view")) allowed.push("calendar");
  if (can(r, "messages.use")) allowed.push("messages");
  if (can(r, "money.view")) allowed.push("money");
  if (can(r, "reports.basic")) allowed.push("reports");
  const newOptions = {
    quote: can(r, "quotes.edit"),
    job: can(r, "jobs.create"),
    customer: can(r, "customers.edit"),
    expense: can(r, "expenses.edit"),
  };
  const [{ unread }] = await db
    .select({ unread: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <Link href="/dashboard" className="px-6 pb-5 pt-6">
          <Logo />
        </Link>
        <div className="flex-1 overflow-y-auto px-3">
          <SidebarNav allowed={allowed} />
        </div>
        <div className="border-t border-slate-100 p-3">
          <UserMenu name={user.name} color={user.color} roleLabel={ROLE_LABELS[user.role]} isAdmin={can(r, "settings.manage")} />
        </div>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex h-16 items-center gap-3 px-4 lg:px-8">
          <Link href="/dashboard" className="lg:hidden">
            <Logo compact />
          </Link>
          <div className="hidden flex-1 lg:block">
            <SearchButton />
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <div className="lg:hidden">
              <SearchButton compact />
            </div>
            <NotificationBell initialUnread={unread} />
            <NewMenu options={newOptions} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 pb-28 pt-6 lg:px-8 lg:pb-12">{children}</main>
      <MobileTabBar allowed={allowed} />
    </div>
  );
}
