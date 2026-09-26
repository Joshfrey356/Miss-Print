import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type SP = Record<string, string | undefined>;

/** Flatten Next's searchParams into simple strings. */
export function flatParams(sp: Record<string, string | string[] | undefined>): SP {
  const out: SP = {};
  for (const [k, v] of Object.entries(sp)) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
}

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "red" | "green" | "amber";
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight tabular sm:text-[28px]",
          tone === "red" ? "text-red-700" : tone === "green" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-slate-900",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
    </>
  );
  const cls = cn("block rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5", href && "transition-colors hover:border-slate-300 hover:bg-slate-50", className);
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Hidden inputs to keep other params when a GET filter form submits. */
export function KeepParams({ params, omit }: { params: SP; omit: string[] }) {
  return (
    <>
      {Object.entries(params)
        .filter(([k, v]) => v != null && v !== "" && !omit.includes(k) && k !== "page")
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
    </>
  );
}

/** Compact label for a filter control. */
export function FilterLabel({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1 text-xs font-medium text-slate-500", className)}>
      {label}
      {children}
    </label>
  );
}

export const filterInput =
  "h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

export function Num({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span className={cn("tabular whitespace-nowrap", className)} title={title}>
      {children}
    </span>
  );
}
