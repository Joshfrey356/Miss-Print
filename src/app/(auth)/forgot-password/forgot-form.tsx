"use client";
import { useActionState } from "react";
import { Input, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { forgotPasswordAction } from "./actions";

export function ForgotForm() {
  const [state, action] = useActionState(forgotPasswordAction, undefined);
  if (state?.sent)
    return (
      <div>
        <p className="text-base font-semibold text-slate-900">Check your email</p>
        <p className="mt-1 text-sm text-slate-600">
          If that email has an account, we sent a link to choose a new password. It works for 2 hours. Nothing there? Check spam, or ask your manager to send you a link from Settings → Team.
        </p>
      </div>
    );
  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-slate-600">Enter the email you sign in with and we&apos;ll send you a link to choose a new password.</p>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus className="h-12 text-base" />
      </div>
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <SubmitButton size="lg" className="w-full" pendingText="Sending…">
        Email me a link
      </SubmitButton>
    </form>
  );
}
