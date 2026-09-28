"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, RefreshCw, TriangleAlert, Unplug, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { useServerAction } from "@/components/use-action";
import { ActionForm, SaveButton } from "../_components/action-form";
import { disconnectQuickBooks, retryQuickBooksFailures, retryQuickBooksRecord, setQuickBooksStartDate, syncQuickBooksNow } from "./quickbooks-actions";

type Summary = { sent: number; failed: number; skipped: number; notes: number; remaining: number; firstError: string | null };

/** "Sync now" / "Retry failed" with the result shown under the buttons. */
export function SyncButtons({ failed }: { failed: number }) {
  const [pending, run] = useServerAction();
  const [which, setWhich] = React.useState<"sync" | "retry" | null>(null);
  const [result, setResult] = React.useState<{ text: string; summary: Summary } | null>(null);
  const go = (kind: "sync" | "retry") => {
    setWhich(kind);
    run(() => (kind === "sync" ? syncQuickBooksNow() : retryQuickBooksFailures()), {
      success: "",
      onSuccess: (r) => setResult({ text: r.message ?? "Done.", summary: r.data as Summary }),
    });
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={pending} onClick={() => go("sync")}>
          {pending && which === "sync" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {pending && which === "sync" ? "Sending…" : "Sync now"}
        </Button>
        {failed > 0 && (
          <Button disabled={pending} onClick={() => go("retry")}>
            {pending && which === "retry" && <Loader2 className="size-4 animate-spin" />}
            Retry {failed === 1 ? "the failed one" : `all ${failed} failed`}
          </Button>
        )}
      </div>
      {result && (
        <div
          role="status"
          className={
            result.summary?.failed
              ? "mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[15px] text-amber-900"
              : "mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[15px] text-emerald-800"
          }
        >
          <p className="font-medium">{result.text}</p>
          {result.summary?.firstError && <p className="mt-0.5 text-sm">First problem: {result.summary.firstError}</p>}
        </div>
      )}
    </div>
  );
}

export function RetryRecordButton({ type, id }: { type: "customer" | "invoice" | "payment"; id: number }) {
  const [pending, run] = useServerAction();
  return (
    <Button size="sm" disabled={pending} onClick={() => run(() => retryQuickBooksRecord(type, id))}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      Retry
    </Button>
  );
}

export function DisconnectButton({ company }: { company: string }) {
  const [pending, run] = useServerAction();
  return (
    <Confirm
      title="Disconnect QuickBooks?"
      description={
        <>
          New invoices and payments will stop going to {company}. Nothing already in QuickBooks is changed or removed, and you can connect again any time.
        </>
      }
      confirmLabel="Disconnect"
      onConfirm={() => run(() => disconnectQuickBooks())}
    >
      <Button variant="ghost" disabled={pending} className="text-red-700 hover:bg-red-50">
        <Unplug className="size-4" />
        Disconnect
      </Button>
    </Confirm>
  );
}

export function StartDateForm({ value }: { value: string }) {
  return (
    <ActionForm action={setQuickBooksStartDate}>
      <label htmlFor="qbo-sync-from" className="block text-[15px] font-semibold text-slate-900">
        Send invoices dated on or after
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Input id="qbo-sync-from" name="syncFrom" type="date" defaultValue={value} required className="w-44" />
        <SaveButton variant="secondary">Save</SaveButton>
      </div>
    </ActionForm>
  );
}

const FLASH: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "QuickBooks is connected. New invoices and payments will be sent automatically." },
  denied: { ok: false, text: "The connection was cancelled in QuickBooks. Nothing was changed." },
  expired: { ok: false, text: "The connection took too long and expired. Please click Connect to QuickBooks again." },
  state: { ok: false, text: "The connection couldn't be verified (it may have been started in another browser or by someone else). Please try again." },
  exchange: { ok: false, text: "QuickBooks didn't finish the sign-in. Please try again; if it keeps happening, check the server's QuickBooks app keys." },
  save: { ok: false, text: "The connection worked but couldn't be saved. Please try again." },
  not_configured: { ok: false, text: "This server isn't set up for QuickBooks yet (see below)." },
  secrets: { ok: false, text: "The server can't store the connection securely yet: APP_SECRET_KEY isn't set." },
  forbidden: { ok: false, text: "Only people who can manage settings can connect QuickBooks." },
  failed: { ok: false, text: "QuickBooks couldn't be connected. Please try again." },
};

/** Message after coming back from Intuit (?quickbooks=connected | error&reason=…). */
export function QuickBooksFlash() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const q = params.get("quickbooks");
  if (!q) return null;
  const f = q === "connected" ? FLASH.connected! : (FLASH[params.get("reason") ?? ""] ?? FLASH.failed!);
  const Icon = f.ok ? CheckCircle2 : TriangleAlert;
  return (
    <div
      role={f.ok ? "status" : "alert"}
      className={`mb-4 flex items-start gap-2 rounded-lg px-3 py-2.5 text-[15px] ${f.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1 font-medium">{f.text}</p>
      <button type="button" aria-label="Dismiss" className="rounded p-0.5 hover:bg-black/5" onClick={() => router.replace(pathname, { scroll: false })}>
        <X className="size-4" />
      </button>
    </div>
  );
}
