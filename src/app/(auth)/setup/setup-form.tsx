"use client";
import { useActionState } from "react";
import { Input, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { setupAction } from "./actions";

export function SetupForm() {
  const [state, action] = useActionState(setupAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" autoComplete="name" required autoFocus className="h-12 text-base" />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required className="h-12 text-base" />
      </div>
      <div>
        <Label htmlFor="password">Password (10+ characters)</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required className="h-12 text-base" />
      </div>
      <div>
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required className="h-12 text-base" />
      </div>
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <SubmitButton size="lg" className="w-full" pendingText="Setting up… (about 30 seconds)">
        Create owner account
      </SubmitButton>
    </form>
  );
}
