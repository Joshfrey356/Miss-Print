import Link from "next/link";
import { RANGE_PRESETS, type DateRange } from "@/lib/reports/range";
import { cn } from "@/lib/utils";

/** Preset buttons + a custom date form. Plain links and a GET form, so it works without JavaScript. */
export function RangePicker({ range, tab }: { range: DateRange; tab: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {RANGE_PRESETS.filter((p) => p.key !== "custom").map((p) => (
        <Link
          key={p.key}
          href={`/reports?${new URLSearchParams({ tab, range: p.key })}`}
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-[15px] font-medium",
            range.key === p.key ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
          )}
        >
          {p.label}
        </Link>
      ))}
      <details className="group relative" open={range.key === "custom"}>
        <summary
          className={cn(
            "cursor-pointer list-none rounded-full border px-3.5 py-1.5 text-[15px] font-medium [&::-webkit-details-marker]:hidden",
            range.key === "custom" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
          )}
        >
          Custom dates
        </summary>
        <form action="/reports" className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:absolute sm:left-0 sm:z-10 sm:mt-2 sm:w-max">
          <input type="hidden" name="tab" value={tab} />
          <input type="hidden" name="range" value="custom" />
          <label className="text-sm font-medium text-slate-700">
            From
            <input type="date" name="from" defaultValue={range.from} className="mt-1 block h-10 rounded-lg border border-slate-300 px-2 text-[15px]" />
          </label>
          <label className="text-sm font-medium text-slate-700">
            To
            <input type="date" name="to" defaultValue={range.to} className="mt-1 block h-10 rounded-lg border border-slate-300 px-2 text-[15px]" />
          </label>
          <button type="submit" className="h-10 rounded-lg bg-brand-500 px-4 text-[15px] font-medium text-white hover:bg-brand-600">
            Show
          </button>
        </form>
      </details>
    </div>
  );
}
