import Link from "next/link";
import { cn } from "@/lib/utils";

/** Filter chips as links (URL-driven). */
export function Chips({ items, active }: { items: { key: string; label: string; href: string; count?: number; tone?: "red" | "default" }[]; active: string | undefined }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => {
        const on = i.key === active;
        return (
          <Link
            key={i.key}
            href={i.href}
            scroll={false}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium",
              on ? "border-brand-500 bg-brand-500 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
            )}
          >
            {i.label}
            {i.count != null && i.count > 0 && (
              <span className={cn("rounded-full px-1.5 text-xs", on ? "bg-white/25 text-white" : i.tone === "red" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600")}>{i.count}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/** Build an href that keeps current params but changes some. */
export function withParams(base: string, current: Record<string, string | undefined>, changes: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...changes })) if (v != null && v !== "") p.set(k, v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}
