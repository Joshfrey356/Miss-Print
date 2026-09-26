"use client";
import { useActionState } from "react";
import { Input, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { signupAction } from "./actions";

export function SignupForm({ needsCode }: { needsCode: boolean }) {
  const [state, action] = useActionState(signupAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="shopName">Shop name</Label>
        <Input id="shopName" name="shopName" autoComplete="organization" required autoFocus maxLength={80} className="h-12 text-base" />
      </div>
      <div>
        <Label htmlFor="phone">Shop phone (optional)</Label>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" maxLength={40} className="h-12 text-base" />
      </div>
      <div>
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" autoComplete="name" required maxLength={80} className="h-12 text-base" />
      </div>
      <div>
        <Label htmlFor="email">Your email (you&apos;ll sign in with it)</Label>
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
      {needsCode && (
        <div>
          <Label htmlFor="code">Sign-up code</Label>
          <Input id="code" name="code" autoComplete="off" required className="h-12 text-base" />
        </div>
      )}
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <SubmitButton size="lg" className="w-full" pendingText="Creating your shop…">
        Create shop account
      </SubmitButton>
    </form>
  );
}
