"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  CalendarDays,
  DollarSign,
  FileText,
  LayoutDashboard,
  MessageSquare,
  BarChart3,
  Users,
  MoreHorizontal,
  Store,
  CalendarClock,
  Package,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const NAV = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { key: "jobs", label: "Jobs", href: "/jobs", icon: Briefcase },
  { key: "quotes", label: "Quotes", href: "/quotes", icon: FileText },
  { key: "customers", label: "Customers", href: "/customers", icon: Users },
  { key: "requests", label: "Requests", href: "/requests", icon: Inbox },
  { key: "calendar", label: "Calendar", href: "/calendar", icon: CalendarDays },
  { key: "schedule", label: "Schedule", href: "/schedule", icon: CalendarClock },
  { key: "messages", label: "Messages", href: "/messages", icon: MessageSquare },
  { key: "counter", label: "Counter", href: "/counter", icon: Store },
  { key: "inventory", label: "Inventory", href: "/inventory", icon: Package },
  { key: "money", label: "Money", href: "/money", icon: DollarSign },
  { key: "reports", label: "Reports", href: "/reports", icon: BarChart3 },
] as const;
export type NavKey = (typeof NAV)[number]["key"];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export function SidebarNav({ allowed, badges }: { allowed: NavKey[]; badges?: Partial<Record<NavKey, number>> }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.filter((n) => allowed.includes(n.key)).map((n) => {
        const active = isActive(pathname, n.href);
        const Icon = n.icon;
        const badge = badges?.[n.key];
        return (
          <Link
            key={n.key}
            href={n.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium",
              active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <Icon className={cn("size-5", active ? "text-brand-500" : "text-slate-400")} />
            <span className="flex-1">{n.label}</span>
            {badge ? <span className="rounded-full bg-brand-500 px-1.5 text-xs font-semibold text-white">{badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Bottom tab bar on phones: the 4 things people need walking around the shop + More. */
export function MobileTabBar({ allowed }: { allowed: NavKey[] }) {
  const pathname = usePathname();
  const primary: NavKey[] = ["dashboard", "jobs", "calendar", "messages"];
  const items = NAV.filter((n) => primary.includes(n.key) && allowed.includes(n.key));
  const moreActive = !items.some((n) => isActive(pathname, n.href)) && pathname.startsWith("/more");
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
      {items.map((n) => {
        const Icon = n.icon;
        const active = isActive(pathname, n.href);
        return (
          <Link key={n.key} href={n.href} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-brand-600" : "text-slate-500")}>
            <Icon className="size-6" />
            {n.label}
          </Link>
        );
      })}
      <Link href="/more" className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium", moreActive ? "text-brand-600" : "text-slate-500")}>
        <MoreHorizontal className="size-6" />
        More
      </Link>
    </nav>
  );
}
