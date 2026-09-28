"use client";
import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { Input, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { requestSignInLink, type SignInState } from "@/app/portal/actions";

export function PortalSignInForm({ email }: { email?: string | null }) {
  const [state, action] = useActionState<SignInState, FormData>(requestSignInLink, undefined);
  if (state?.sent)
    return (
      <div className="text-center">
        <MailCheck className="mx-auto size-10 text-brand-500" />
        <p className="mt-3 text-lg font-semibold text-slate-900">Check your email</p>
        <p className="mt-1 text-[15px] text-slate-600">If that email is on file, we sent a sign-in link. It works once, for 7 days. Nothing there? Check your spam folder, or give us a call.</p>
      </div>
    );
  return (
    <form action={action} className="space-y-4">
      <p className="text-[15px] text-slate-700">Enter your email to get a sign-in link.</p>
      <div>
        <Label htmlFor="portal-email">Email</Label>
        <Input id="portal-email" name="email" type="email" autoComplete="email" inputMode="email" required autoFocus defaultValue={email ?? undefined} className="h-12 text-base" />
      </div>
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <SubmitButton size="lg" className="w-full" pendingText="Sending…">
        Email me a sign-in link
      </SubmitButton>
    </form>
  );
}
