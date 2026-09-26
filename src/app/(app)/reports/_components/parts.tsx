import Link from "next/link";
import { Download } from "lucide-react";
import { fmtDate, money, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { monthLabel } from "@/lib/reports/range";
import { REPORTS, runReport, type Column, type ReportCtx, type ReportKey, type Row } from "@/lib/reports/registry";
import type { DateRange } from "@/lib/reports/range";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export function Stat({
  label,
  value,
  sub,
  href,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  tone?: "default" | "bad" | "good";
}) {
  const body = (
    <>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={cn("mt-1 text-3xl font-semibold tracking-tight tabular", tone === "bad" ? "text-red-700" : tone === "good" ? "text-emerald-700" : "text-slate-900")}>
        {value}
      </p>
      {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300">
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">{body}</div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

function fmt(c: Column, v: Row[string]) {
  if (v == null || v === "") return "—";
  if (typeof v === "number") {
    switch (c.kind) {
      case "money":
        return money(v, { cents: false });
      case "pct":
        return pct(v);
      case "days":
        return `${v.toFixed(1)} days`;
      case "int":
        return v.toLocaleString("en-US");
      default:
        return String(v);
    }
  }
  if (c.kind === "date") return fmtDate(v, { year: true, weekday: false });
  return v;
}

const isNum = (c: Column) => c.kind !== "text" && c.kind !== "date";

/** Month-by-month columns. Labels only the best month and the latest month; hover any bar for its value. */
function MonthColumns({ rows, valueKey, kind }: { rows: Row[]; valueKey: string; kind: Column["kind"] }) {
  const vals = rows.map((r) => Number(r[valueKey] ?? 0));
  const max = Math.max(1, ...vals);
  const best = vals.indexOf(Math.max(...vals));
  const show = (v: number) => (kind === "money" ? money(v, { cents: false }) : v.toLocaleString("en-US"));
  return (
    <div className="px-5 pb-2 pt-5" aria-hidden>
      <div className="flex h-48 items-end gap-[2px] border-b border-slate-200">
        {rows.map((r, i) => {
          const v = vals[i]!;
          const labelled = (i === best || i === rows.length - 1) && v > 0;
          return (
            <div key={String(r.month)} className="group relative flex h-full flex-1 flex-col justify-end" title={`${r.label}: ${show(v)}`}>
              {labelled && <span className="mb-1 text-center text-xs font-medium whitespace-nowrap text-slate-700 tabular">{show(v)}</span>}
              <div
                className="mx-auto w-full max-w-12 rounded-t bg-brand-500 group-hover:bg-brand-600"
                style={{ height: `${Math.max(v > 0 ? 2 : 0, (v / max) * 85)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[2px]">
        {rows.map((r, i) => (
          <span key={String(r.month)} className={cn("flex-1 text-center text-xs text-slate-500", rows.length > 8 && i % 2 === 1 && "max-sm:invisible")}>
            {monthLabel(String(r.month))}
          </span>
        ))}
      </div>
    </div>
  );
}

function DataTable({ columns, rows, bar, targetMarginPct }: { columns: Column[]; rows: Row[]; bar?: string; targetMarginPct: number }) {
  const barMax = bar ? Math.max(1, ...rows.map((r) => Number(r[bar] ?? 0))) : 1;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[15px]">
        <thead className="border-b border-slate-200 bg-slate-50/60 text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cn("px-4 py-2.5 font-medium whitespace-nowrap", isNum(c) && "text-right", c.wide && "hidden md:table-cell")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0">
              {columns.map((c) => {
                const v = r[c.key];
                const text = fmt(c, v);
                const low = c.key === "margin" && typeof v === "number" && v < targetMarginPct;
                const href = c.href ? (r[c.href] as string | null) : null;
                return (
                  <td key={c.key} className={cn("px-4 py-2.5 align-middle", isNum(c) && "text-right whitespace-nowrap tabular", c.wide && "hidden md:table-cell", low && "font-medium text-red-700")}>
                    {bar === c.key && typeof v === "number" ? (
                      <div className="flex items-center justify-end gap-3">
                        <div className="hidden h-2 w-28 overflow-hidden rounded bg-slate-100 sm:block lg:w-40">
                          <div className="h-full rounded bg-brand-500" style={{ width: `${(v / barMax) * 100}%` }} />
                        </div>
                        <span className="min-w-16">{text}</span>
                      </div>
                    ) : href ? (
                      <Link href={href} className="font-medium text-brand-700 hover:underline">
                        {text}
                      </Link>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One report: title, CSV download, optional month chart, and the table. */
export async function ReportCard({
  id,
  range,
  ctx,
  query,
  action,
}: {
  id: ReportKey;
  range: DateRange;
  ctx: ReportCtx;
  query: Record<string, string>;
  action?: React.ReactNode;
}) {
  const def = REPORTS[id];
  const t = await runReport(id, range, ctx);
  const monthly = "monthly" in def ? def.monthly : undefined;
  const bar = "bar" in def ? def.bar : undefined;
  const hasData = monthly ? t.rows.some((r) => Number(r[monthly.valueKey] ?? 0) > 0) : t.rows.length > 0;
  const csv = `/reports/export?${new URLSearchParams({ ...query, report: id })}`;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={def.title}
        description={def.description}
        action={
          <div className="flex items-center gap-2">
            {action}
            {hasData && (
              <a href={csv} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900" download>
                <Download className="size-4" /> CSV
              </a>
            )}
          </div>
        }
      />
      {!hasData ? (
        <EmptyState compact title={def.empty} />
      ) : monthly ? (
        <>
          <MonthColumns rows={t.rows} valueKey={monthly.valueKey} kind={t.columns.find((c) => c.key === monthly.valueKey)?.kind ?? "int"} />
          <details className="border-t border-slate-100">
            <summary className="cursor-pointer px-5 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900">Show as a table</summary>
            <DataTable columns={t.columns} rows={t.rows} targetMarginPct={ctx.targetMarginPct} />
          </details>
        </>
      ) : (
        <DataTable columns={t.columns} rows={t.rows} bar={bar} targetMarginPct={ctx.targetMarginPct} />
      )}
      {t.note && hasData && <p className="border-t border-slate-100 px-5 py-2.5 text-sm text-amber-800">{t.note}</p>}
    </Card>
  );
}
