import Link from "next/link";
import { cn } from "@/lib/utils";

/** URL-driven tabs (bookmarkable, work without JS). */
export function LinkTabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cn(
            "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[15px] font-medium",
            t.key === active ? "border-brand-500 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800",
          )}
        >
          {t.label}
          {t.count != null && t.count > 0 && (
            <span className={cn("rounded-full px-1.5 text-xs", t.key === active ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-600")}>
              {t.count}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
