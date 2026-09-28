import { Avatar } from "@/components/ui/avatar";
import { fmtDateTime } from "@/lib/format";

type A = { id: number; action: string; summary: string; at: Date; by: string | null; byColor: string | null };

/** Who did what, when — the job's permanent record. */
export function HistoryPanel({ activity }: { activity: A[] }) {
  if (!activity.length) return <p className="text-sm text-slate-500">No history yet.</p>;
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-6">
      {activity.map((a) => (
        <li key={a.id} className="relative">
          <span className="absolute -left-[33px] top-0.5">
            {a.by ? <Avatar name={a.by} color={a.byColor} size="sm" /> : <span className="block size-6 rounded-full border-2 border-white bg-slate-300" />}
          </span>
          <p className="text-[15px] text-slate-800">
            <span className="font-medium">{a.by ?? "Customer / system"}</span> <span className="text-slate-600">{lower(a.summary)}</span>
          </p>
          <p className="text-xs text-slate-400">{fmtDateTime(a.at)}</p>
        </li>
      ))}
    </ol>
  );
}

const lower = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^(Proof|Invoice|Payment|Price|[A-Z]{1,5}-\d)/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);
