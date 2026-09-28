"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, ThumbsDown } from "lucide-react";
import { toast } from "sonner";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { acceptQuote, declineQuote } from "@/app/portal/actions";

type Line = { id: number; description: string; choices: { quantity: number; cents: number; main: boolean }[] };

/** Accept (typed name + "I accept", optional note and quantity choice) or decline (with a reason). */
export function QuoteResponse({ quoteId, lines, defaultName, total }: { quoteId: number; lines: Line[]; defaultName: string; total: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"accept" | "decline" | null>(null);
  const [name, setName] = useState(defaultName);
  const [agree, setAgree] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((l) => [String(l.id), l.choices.find((c) => c.main)!.quantity])));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const withChoices = lines.filter((l) => l.choices.length > 1);

  const submit = () =>
    start(async () => {
      setError(null);
      const r = mode === "accept" ? await acceptQuote(quoteId, { name, agree, note, quantities: qty }) : await declineQuote(quoteId, reason);
      if (!r.ok) return setError(r.error);
      toast.success(r.message ?? "Thanks!");
      router.refresh();
    });

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
        <button type="button" onClick={() => setMode("accept")} className={cn("flex h-14 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-lg font-semibold text-white hover:bg-emerald-700", mode === "accept" && "ring-4 ring-emerald-200")}>
          <CheckCircle2 className="size-6" /> Accept quote
        </button>
        <button type="button" onClick={() => setMode("decline")} className={cn("flex h-14 items-center justify-center gap-2 rounded-xl border-2 text-base font-semibold", mode === "decline" ? "border-slate-500 bg-slate-50 text-slate-900" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
          <ThumbsDown className="size-5" /> No thanks
        </button>
      </div>
      {mode === "accept" && (
        <div className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          {withChoices.map((l) => (
            <fieldset key={l.id}>
              <legend className="mb-1.5 text-sm font-medium text-slate-700">How many {l.description}?</legend>
              <div className="flex flex-wrap gap-2">
                {l.choices.map((c) => {
                  const on = qty[String(l.id)] === c.quantity;
                  return (
                    <label key={c.quantity} className={cn("cursor-pointer rounded-xl border-2 px-3 py-2 text-[15px]", on ? "border-brand-500 bg-brand-50 text-brand-900" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300")}>
                      <input type="radio" className="sr-only" name={`q${l.id}`} checked={on} onChange={() => setQty({ ...qty, [String(l.id)]: c.quantity })} />
                      <span className="tabular font-semibold">{c.quantity.toLocaleString()}</span> for <span className="tabular">{money(c.cents)}</span>
                      {c.main && <span className="block text-xs text-slate-500">as quoted</span>}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <Field label="Type your full name" htmlFor="qr-name" required>
            <Input id="qr-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="h-12 text-base" />
          </Field>
          <Field label="Note for us (optional)" htmlFor="qr-note">
            <Textarea id="qr-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="PO number, delivery details, questions…" />
          </Field>
          <Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)} label={<span className="font-medium">I accept this quote{withChoices.length ? " for the quantities chosen above" : ` (${total})`}.</span>} />
          {withChoices.length > 0 && <p className="text-sm text-slate-500">If you picked a different quantity, we&apos;ll update the total and sales tax on your order.</p>}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button variant="success" size="lg" className="w-full" disabled={pending} onClick={submit}>
            {pending && <Loader2 className="size-4 animate-spin" />} Accept this quote
          </Button>
        </div>
      )}
      {mode === "decline" && (
        <div className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <Field label="Could you tell us why?" htmlFor="qr-reason" required>
            <Textarea id="qr-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Price, timing, went another way…" />
          </Field>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button size="lg" className="w-full" disabled={pending} onClick={submit}>
            {pending && <Loader2 className="size-4 animate-spin" />} Decline this quote
          </Button>
        </div>
      )}
    </div>
  );
}
