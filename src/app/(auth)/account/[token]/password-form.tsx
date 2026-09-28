"use client";
import { useActionState } from "react";
import { Input, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { setPasswordAction } from "./actions";

export function PasswordForm({ token, email, invite }: { token: string; email: string; invite: boolean }) {
  const [state, action] = useActionState(setPasswordAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {/* Lets password managers save the new password under the right account. */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      <div>
        <Label htmlFor="password">{invite ? "Choose a password" : "New password"} (10+ characters)</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required autoFocus className="h-12 text-base" />
      </div>
      <div>
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required className="h-12 text-base" />
      </div>
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <SubmitButton size="lg" className="w-full" pendingText="Saving…">
        {invite ? "Set password & sign in" : "Save new password & sign in"}
      </SubmitButton>
    </form>
  );
}
