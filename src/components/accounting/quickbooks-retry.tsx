"use client";
import { Loader2, RefreshCw } from "lucide-react";
import { useServerAction } from "@/components/use-action";
import { retryQuickBooksRecord } from "@/app/(app)/settings/integrations/quickbooks-actions";

/** The "retry" part of the QuickBooks status badge. */
export function QuickBooksRetry({ type, id }: { type: "customer" | "invoice" | "payment"; id: number }) {
  const [pending, run] = useServerAction();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => run(() => retryQuickBooksRecord(type, id))}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-red-700 underline-offset-2 hover:bg-red-50 hover:underline disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
      {pending ? "Retrying…" : "Retry"}
    </button>
  );
}
