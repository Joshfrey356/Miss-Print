"use client";
import { useActionState } from "react";
import { CreditCard } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { payInvoiceOnline, type PayState } from "@/app/portal/actions";

/** "Pay online" → the shop's Stripe payment page for the invoice's balance. */
export function PortalPayButton({ invoiceId, label }: { invoiceId: number; label: string }) {
  const [state, action] = useActionState<PayState>(payInvoiceOnline.bind(null, invoiceId), undefined);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton size="lg" className="w-full sm:w-auto" pendingText="Opening secure payment page…">
        <CreditCard className="size-5" /> {label}
      </SubmitButton>
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
