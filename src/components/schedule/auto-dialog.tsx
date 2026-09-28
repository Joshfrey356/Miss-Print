"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PriorityBadge } from "@/components/status";
import { useJobNo } from "@/components/shop-context";
import { dueLabel } from "@/lib/format";
import { durationLabel, rangeLabel } from "@/lib/schedule/time";
import type { AutoPreview } from "@/lib/schedule/types";
import { commitAutoScheduleAction, previewAutoScheduleAction } from "@/app/(app)/schedule/actions";
import { cn } from "@/lib/utils";

/**
 * "Auto-schedule all waiting": shows where everything would go (earliest due date first, rush and
 * critical first on the same day), lets the person untick pieces, then books them.
 */
export function AutoScheduleDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const jobNo = useJobNo();
  const [preview, setPreview] = React.useState<AutoPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [off, setOff] = React.useState<Set<string>>(new Set());
  const [saving, start] = React.useTransition();

  React.useEffect(() => {
    let live = true;
    previewAutoScheduleAction().then((r) => {
      if (!live) return;
      if (r.ok) setPreview(r.data!);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, []);

  const k = (p: { jobId: number; key: string }) => `${p.jobId}|${p.key}`;
  const chosen = preview?.proposals.filter((p) => !off.has(k(p))) ?? [];
  const late = chosen.filter((p) => p.late).length;

  const book = () =>
    start(async () => {
      const r = await commitAutoScheduleAction(chosen.map((p) => ({ jobId: p.jobId, key: p.key, equipmentId: p.equipmentId, segments: p.segments })));
      if (!r.ok) return void toast.error(r.error);
      const { booked, skipped } = r.data!;
      toast.success(`Booked ${booked} ${booked === 1 ? "piece" : "pieces"} of work`, skipped ? { description: `${skipped} skipped: already booked by someone else, or the machine was turned off.` } : undefined);
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide title="Auto-schedule all waiting" description="Earliest due date first; rush and critical jobs first on the same day. Each piece goes into the first free time on its machine, within working hours. Finishing waits for printing. Nothing is booked until you say so.">
        {!preview && !error && (
          <p className="flex items-center gap-2 py-8 text-slate-500">
            <Loader2 className="size-5 animate-spin" /> Working it out…
          </p>
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        {preview && (
          <>
            {preview.proposals.length === 0 ? (
              <p className="py-6 text-center text-slate-600">Nothing is waiting to be scheduled.</p>
            ) : (
              <ul className="max-h-[55vh] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {preview.proposals.map((p) => {
                  const on = !off.has(k(p));
                  return (
                    <li key={k(p)} className={cn("flex items-start gap-3 px-3 py-2.5", !on && "opacity-50")}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setOff((s) => (s.has(k(p)) ? new Set([...s].filter((x) => x !== k(p))) : new Set([...s, k(p)])))}
                        className="mt-1 size-[18px] accent-brand-500"
                        aria-label={`Book ${p.label} for ${jobNo(p.jobNumber)}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2 text-[15px]">
                          <span className="font-semibold text-slate-900">{jobNo(p.jobNumber)}</span>
                          <span className="text-slate-700">{p.label}</span>
                          <PriorityBadge priority={p.priority} />
                          <span className={cn("ml-auto text-sm", p.late ? "font-semibold text-red-600" : "text-slate-500")}>Due {dueLabel(p.dueDate)}</span>
                        </p>
                        <p className="truncate text-sm text-slate-500">
                          {p.customer} · {p.itemDescription}
                        </p>
                        <p className="text-sm text-slate-800">
                          <span className="font-medium">{p.machineName}</span> · {p.segments.map((s) => rangeLabel(s.start, s.end)).join(", ")} · {durationLabel(p.minutes)}
                        </p>
                        {p.late && (
                          <p className="mt-0.5 flex items-center gap-1 text-sm font-medium text-red-700">
                            <AlertTriangle className="size-4" /> Ends after the job is due
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {preview.skipped.length > 0 && (
              <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-medium">Not scheduled:</p>
                <ul className="list-disc pl-5">
                  {preview.skipped.map((s, i) => (
                    <li key={i}>
                      {jobNo(s.jobNumber)} {s.label} — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {late > 0 && <p className="text-sm text-red-700">{late === 1 ? "1 piece ends" : `${late} pieces end`} after the job is due.</p>}
              <div className="ml-auto flex gap-2">
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="primary" disabled={saving || chosen.length === 0} onClick={book}>
                  <Sparkles className="size-4" /> {saving ? "Booking…" : `Book ${chosen.length} ${chosen.length === 1 ? "piece" : "pieces"}`}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
