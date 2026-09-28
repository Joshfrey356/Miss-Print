"use client";
import { useActionState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { startCheckout, type StartState } from "./actions";

export function PayButton({ token, label }: { token: string; label: string }) {
  const [state, action, pending] = useActionState<StartState, FormData>(startCheckout.bind(null, token), undefined);
  return (
    <form action={action} className="mt-6">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-6 text-lg font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-5 animate-spin" /> : <CreditCard className="size-5" />}
        {label}
      </button>
      {state?.error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[15px] font-medium text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}
