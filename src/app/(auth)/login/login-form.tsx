"use client";
import { useActionState } from "react";
import { Input, Label } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { loginAction } from "./actions";

export function LoginForm({ next, demo }: { next?: string; demo: boolean }) {
  const [state, action] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus className="h-12 text-base" />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-12 text-base" />
      </div>
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <SubmitButton size="lg" className="w-full" pendingText="Signing in…">
        Sign in
      </SubmitButton>
      {demo && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
          <p className="font-medium text-slate-700">Demo accounts</p>
          <p className="mt-1">
            <code>owner@missprintusa.com</code> (owner), <code>sarah@</code> (designer), <code>mike@</code> (production),{" "}
            <code>alex@</code> (front counter), <code>dana@</code> (accounting), <code>tony@</code> (installer).
          </p>
          <p className="mt-1">
            Password: <code>missprint2026</code>
          </p>
        </div>
      )}
    </form>
  );
}
