"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, MessageSquare } from "lucide-react";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { respondToProofInPortal } from "@/app/portal/actions";

/** Approve a proof or ask for changes (the same audited record as the emailed proof link). */
export function ProofReview({ proofId, defaultName, statement }: { proofId: number; defaultName: string; statement: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"approve" | "changes" | null>(null);
  const [name, setName] = useState(defaultName);
  const [comment, setComment] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"approve" | "changes" | null>(null);
  const [pending, start] = useTransition();

  if (done)
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
        <CheckCircle2 className="mx-auto size-9 text-emerald-600" />
        <p className="mt-2 text-lg font-semibold text-emerald-900">{done === "approve" ? "Thank you — your proof is approved." : "Thank you — we got your changes."}</p>
        <p className="text-emerald-800">{done === "approve" ? "We'll get it into production." : "We'll send you an updated proof."}</p>
      </div>
    );

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await respondToProofInPortal(proofId, { decision: mode!, name, comment, agree });
      if (!r.ok) return setError(r.error);
      setDone(mode);
      router.refresh();
    });

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => setMode("approve")} className={cn("flex h-14 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-lg font-semibold text-white hover:bg-emerald-700", mode === "approve" && "ring-4 ring-emerald-200")}>
          <CheckCircle2 className="size-6" /> Approve proof
        </button>
        <button type="button" onClick={() => setMode("changes")} className={cn("flex h-14 items-center justify-center gap-2 rounded-xl border-2 text-lg font-semibold", mode === "changes" ? "border-amber-500 bg-amber-50 text-amber-900 ring-4 ring-amber-100" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50")}>
          <MessageSquare className="size-6" /> Request changes
        </button>
      </div>
      {mode && (
        <div className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <Field label="Your name" htmlFor="pr-name" required>
            <Input id="pr-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          {mode === "changes" ? (
            <Field label="What should we change?" htmlFor="pr-comment" required>
              <Textarea id="pr-comment" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Please change the phone number to…" />
            </Field>
          ) : (
            <>
              <Field label="Comments (optional)" htmlFor="pr-comment">
                <Textarea id="pr-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
              </Field>
              <Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)} label={statement} />
            </>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button variant={mode === "approve" ? "success" : "primary"} size="lg" className="w-full" disabled={pending} onClick={submit}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {mode === "approve" ? "Approve this proof" : "Send my changes"}
          </Button>
        </div>
      )}
    </div>
  );
}
