import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative overflow-x-auto">
      <table className={cn("w-full text-left text-[15px]", className)} {...props} />
    </div>
  );
}
export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="border-b border-slate-200 bg-slate-50/60 text-xs font-medium uppercase tracking-wide text-slate-500" {...props} />;
}
export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("px-4 py-2.5 font-medium whitespace-nowrap", className)} {...props} />;
}
export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}
export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-slate-100 last:border-0", className)} {...props} />;
}

/** Sortable column header that updates ?sort=&dir= in the URL. */
export function SortTh({
  label,
  field,
  sort,
  dir,
  params,
  className,
}: {
  label: string;
  field: string;
  sort?: string;
  dir?: string;
  params: Record<string, string | undefined>;
  className?: string;
}) {
  const active = sort === field;
  const nextDir = active && dir === "asc" ? "desc" : "asc";
  const qs = new URLSearchParams(
    Object.entries({ ...params, sort: field, dir: nextDir, page: undefined }).filter(([, v]) => v != null && v !== "") as [string, string][],
  );
  return (
    <Th className={className}>
      <Link href={`?${qs}`} className={cn("inline-flex items-center gap-1 hover:text-slate-800", active && "text-slate-800")}>
        {label}
        {active && (dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </Link>
    </Th>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) =>
    `?${new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v != null && v !== "") as [string, string][])}`;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50" href={href(page - 1)}>
            Previous
          </Link>
        )}
        {page < pages && (
          <Link className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50" href={href(page + 1)}>
            Next
          </Link>
        )}
      </div>
    </div>
  );
}
