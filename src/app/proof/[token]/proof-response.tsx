"use client";
import { useActionState, useState } from "react";
import { CheckCircle2, MessageSquare } from "lucide-react";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";
import { respondToProof, type ProofResponseState } from "./actions";
import { approvalStatement } from "./statement";

/** `shopName` is the shop that sent the proof: the customer agrees that it produces the job. */
export function ProofResponse({ token, shopName }: { token: string; shopName: string }) {
  const [mode, setMode] = useState<"approve" | "changes" | null>(null);
  const [state, action] = useActionState<ProofResponseState, FormData>(respondToProof.bind(null, token), undefined);

  if (state?.ok)
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
        <p className="mt-3 text-lg font-semibold text-emerald-900">{mode === "approve" ? "Thank you — your proof is approved." : "Thank you — we got your changes."}</p>
        <p className="mt-1 text-emerald-800">{mode === "approve" ? "We'll get it into production." : "Our designer will send you an updated proof."}</p>
      </div>
    );

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => setMode("approve")} className={cn("flex h-16 items-center justify-center gap-2 rounded-xl text-lg font-semibold", mode === "approve" ? "bg-emerald-600 text-white ring-4 ring-emerald-200" : "bg-emerald-600 text-white hover:bg-emerald-700")}>
          <CheckCircle2 className="size-6" /> APPROVE PROOF
        </button>
        <button type="button" onClick={() => setMode("changes")} className={cn("flex h-16 items-center justify-center gap-2 rounded-xl border-2 text-lg font-semibold", mode === "changes" ? "border-amber-500 bg-amber-50 text-amber-900 ring-4 ring-amber-100" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50")}>
          <MessageSquare className="size-6" /> REQUEST CHANGES
        </button>
      </div>
      {mode && (
        <form action={action} className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <input type="hidden" name="decision" value={mode} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Your name" required>
              <Input name="name" required autoComplete="name" />
            </Field>
            <Field label="Your email">
              <Input name="email" type="email" autoComplete="email" />
            </Field>
          </div>
          {mode === "changes" ? (
            <Field label="What should we change?" required>
              <Textarea name="comment" rows={4} required placeholder="Please change the phone number to…" />
            </Field>
          ) : (
            <>
              <Field label="Comments (optional)">
                <Textarea name="comment" rows={2} />
              </Field>
              <Checkbox name="agree" label={approvalStatement(shopName)} />
            </>
          )}
          {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
          <SubmitButton size="lg" variant={mode === "approve" ? "success" : "primary"} className="w-full" pendingText="Sending…">
            {mode === "approve" ? "Approve this proof" : "Send my changes"}
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
