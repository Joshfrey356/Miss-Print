"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, MoneyInput, Textarea } from "@/components/ui/input";
import { reorderJobAction } from "@/app/(app)/jobs/actions";
import { quoteReorderPrice } from "@/app/(app)/quotes/actions";
import { addDays, centsToInput, fmtDate, money, parseMoney, today } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ReorderDialog({
  open,
  onOpenChange,
  job,
  canSeeMoney,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  job: { id: number; number: number; title: string; quantity: number; priceCents: number; itemCount: number; completedAt: Date | null };
  canSeeMoney: boolean;
}) {
  const [sameQty, setSameQty] = useState(true);
  const [qty, setQty] = useState(job.quantity);
  const [sameArt, setSameArt] = useState(true);
  const [sameSpecs, setSameSpecs] = useState(true);
  const [due, setDue] = useState(addDays(today(), 5));
  const [price, setPrice] = useState(centsToInput(job.priceCents));
  const [notes, setNotes] = useState("");
  const [recommended, setRecommended] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const effectiveQty = sameQty ? job.quantity : qty;
  useEffect(() => {
    if (!open || !canSeeMoney) return;
    let live = true;
    quoteReorderPrice(job.id, effectiveQty).then((r) => {
      if (!live || !r.ok) return;
      setRecommended(r.data?.recommendedCents ?? null);
      if (!sameQty && r.data?.recommendedCents) setPrice(centsToInput(r.data.recommendedCents));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, effectiveQty]);

  const submit = () =>
    start(async () => {
      const r = await reorderJobAction(job.id, {
        sameQuantity: sameQty,
        quantity: sameQty ? undefined : qty,
        sameArtwork: sameArt,
        sameSpecs,
        dueDate: due,
        priceCents: canSeeMoney && job.itemCount === 1 ? parseMoney(price) : null,
        notes: notes || null,
      });
      if (r && !r.ok) toast.error(r.error);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Reorder: ${job.title}`} description={job.completedAt ? `Last done ${fmtDate(job.completedAt.toISOString().slice(0, 10), { year: true })}. Specs, materials, artwork and customer info are copied.` : "Specs, materials, artwork and customer info are copied."}>
        <div className="space-y-5">
          <YesNo label="Same quantity?" value={sameQty} onChange={setSameQty} yes={`Yes — ${job.quantity.toLocaleString()}`} />
          {!sameQty && (
            <Field label="New quantity">
              <Input type="number" min="1" value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} autoFocus />
            </Field>
          )}
          <YesNo label="Same artwork?" value={sameArt} onChange={setSameArt} hint={sameArt ? "Files are linked to the new job." : "The new job will wait for new artwork."} />
          <YesNo label="Same specifications?" value={sameSpecs} onChange={setSameSpecs} hint={sameArt && sameSpecs ? "Goes straight to Ready for Production — no proof needed." : "A proof will be made first."} />
          <Field label="Needed by">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          {canSeeMoney && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-500">Previous price</p>
                  <p className="tabular text-lg font-semibold text-slate-900">{money(job.priceCents)}</p>
                  {!sameQty && <p className="text-xs text-slate-500">for {job.quantity.toLocaleString()}</p>}
                </div>
                <div>
                  <p className="text-slate-500">Current recommended</p>
                  <p className="tabular text-lg font-semibold text-slate-900">{recommended != null ? money(recommended) : "—"}</p>
                  {!sameQty && <p className="text-xs text-slate-500">for {effectiveQty.toLocaleString()}</p>}
                </div>
              </div>
              {job.itemCount === 1 ? (
                <Field label="Price for this order" className="mt-3">
                  <MoneyInput value={price} onChange={(e) => setPrice(e.target.value)} />
                </Field>
              ) : (
                <p className="mt-3 text-xs text-slate-500">This job has {job.itemCount} items — prices are copied; adjust them on the new job.</p>
              )}
            </div>
          )}
          <Field label="Notes (optional)">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Change phone number on back…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={pending}>
              <RotateCcw className="size-4" /> {pending ? "Creating…" : "Create reorder"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function YesNo({ label, value, onChange, yes = "Yes", hint }: { label: string; value: boolean; onChange: (v: boolean) => void; yes?: string; hint?: string }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-slate-700">{label}</p>
      <div className="inline-flex rounded-lg border border-slate-300 p-0.5">
        {[true, false].map((v) => (
          <button key={String(v)} type="button" onClick={() => onChange(v)} className={cn("rounded-md px-4 py-1.5 text-sm font-medium", value === v ? "bg-brand-500 text-white" : "text-slate-600 hover:bg-slate-100")}>
            {v ? yes : "No"}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Opens the dialog automatically when the URL has ?reorder=1 (links from customer pages). */
export function useReorderParam(): [boolean, (o: boolean) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(params.get("reorder") === "1");
  const set = (o: boolean) => {
    setOpen(o);
    if (!o && params.get("reorder")) router.replace(pathname, { scroll: false });
  };
  return [open, set];
}
