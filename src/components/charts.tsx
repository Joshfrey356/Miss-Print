import { cn } from "@/lib/utils";

/**
 * Small, dependency-free charts. Single series → one brand hue, no legend (the card title names it).
 * Columns ≤24px with 4px rounded data-end, hairline gridlines, hover tooltip, and a screen-reader table.
 */
export function ColumnChart({
  data,
  format,
  height = 180,
  highlightLast = true,
  label,
}: {
  data: { label: string; value: number; sub?: string }[];
  format: (v: number) => string;
  height?: number;
  highlightLast?: boolean;
  label: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step || step;
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  return (
    <figure>
      <div className="flex gap-2">
        <div className="relative w-12 shrink-0 text-right text-[11px] text-slate-400" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="tabular absolute right-0 -translate-y-1/2" style={{ top: `${100 - (t / top) * 100}%` }}>
              {format(t)}
            </span>
          ))}
        </div>
        <div className="relative flex-1" style={{ height }}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-slate-100" style={{ top: `${100 - (t / top) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {data.map((d, i) => {
              const last = highlightLast && i === data.length - 1;
              return (
                <div key={d.label} className="group relative flex h-full flex-1 items-end justify-center">
                  <div
                    className={cn("w-full max-w-6 rounded-t transition-colors", last ? "bg-brand-500" : "bg-brand-300 group-hover:bg-brand-400")}
                    style={{ height: `${(d.value / top) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }}
                  />
                  <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow group-hover:block">
                    <span className="font-medium">{d.label}</span> · <span className="tabular">{format(d.value)}</span>
                    {d.sub && <span className="text-slate-300"> · {d.sub}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ml-14 mt-1.5 flex gap-[2px] text-[11px] text-slate-400">
        {data.map((d, i) => (
          <span key={d.label} className="flex-1 truncate text-center">
            {data.length > 8 && i % 2 === 1 ? "" : d.label}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th>{d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Horizontal bars, sorted by the caller. Value label at the bar tip in text ink. */
export function BarList({ data, format, max }: { data: { label: string; value: number; sub?: string; href?: string }[]; format: (v: number) => string; max?: number }) {
  const m = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.label} className="group" title={`${d.label}: ${format(d.value)}${d.sub ? ` · ${d.sub}` : ""}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-slate-700">{d.label}</span>
            <span className="tabular shrink-0 font-medium text-slate-900">
              {format(d.value)}
              {d.sub && <span className="ml-1.5 text-xs font-normal text-slate-400">{d.sub}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-brand-400 group-hover:bg-brand-500" style={{ width: `${Math.max(1, (d.value / m) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}
