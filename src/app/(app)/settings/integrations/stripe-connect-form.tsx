"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Field, Input } from "@/components/ui/input";
import { useServerAction } from "@/components/use-action";
import { connectStripeAction, disconnectStripeAction } from "./stripe-actions";

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <code className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">{value}</code>
      <Button
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast.error("Couldn't copy — select the text and copy it instead.");
          }
        }}
      >
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** Paste the secret key + webhook signing secret. */
export function StripeConnectForm({ replacing, disabled }: { replacing?: boolean; disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(!replacing);
  const [error, setError] = React.useState<string | null>(null);
  const [offerSkip, setOfferSkip] = React.useState(false);
  const [pending, start] = React.useTransition();
  const formRef = React.useRef<HTMLFormElement>(null);

  const submit = (skipCheck: boolean) => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    const fd = new FormData(form);
    if (skipCheck) fd.set("skipCheck", "1");
    start(async () => {
      const r = await connectStripeAction(null, fd);
      if (!r.ok) {
        setError(r.error);
        if (/reach Stripe/i.test(r.error)) setOfferSkip(true);
        return;
      }
      setError(null);
      setOfferSkip(false);
      toast.success(r.data?.checked ? `Stripe connected${r.data.accountName ? ` — ${r.data.accountName}` : ""}` : "Saved. The key wasn't checked with Stripe yet.");
      form.reset();
      if (replacing) setOpen(false);
      router.refresh();
    });
  };

  if (!open)
    return (
      <Button onClick={() => setOpen(true)} disabled={disabled}>
        Replace keys
      </Button>
    );
  return (
    <form
      ref={formRef}
      className="w-full space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <Field label="Secret key" htmlFor="stripe-sk" required hint="Stripe → Developers → API keys → Secret key (sk_live_… or sk_test_…). A restricted key (rk_…) with “Checkout Sessions: Write” works too.">
        <Input id="stripe-sk" name="secretKey" type="password" autoComplete="off" spellCheck={false} placeholder="sk_live_…" required disabled={disabled} className="font-mono" />
      </Field>
      <Field label="Webhook signing secret" htmlFor="stripe-whsec" required hint="Stripe → Developers → Webhooks → your endpoint → Signing secret (whsec_…).">
        <Input id="stripe-whsec" name="webhookSecret" type="password" autoComplete="off" spellCheck={false} placeholder="whsec_…" required disabled={disabled} className="font-mono" />
      </Field>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[15px] font-medium text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending || disabled}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {replacing ? "Save new keys" : "Connect Stripe"}
        </Button>
        {offerSkip && (
          <Button onClick={() => submit(true)} disabled={pending || disabled}>
            Save without checking
          </Button>
        )}
        {replacing && (
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function StripeDisconnectButton() {
  const router = useRouter();
  const [pending, run] = useServerAction();
  return (
    <Confirm
      title="Disconnect Stripe?"
      description="The saved keys are erased. The counter's “Card by phone” and online pay links stop working until you connect again. Payments already recorded stay as they are."
      confirmLabel="Disconnect"
      onConfirm={() => run(() => disconnectStripeAction(), { onSuccess: () => router.refresh() })}
    >
      <Button variant="ghost" className="text-red-700 hover:bg-red-50" disabled={pending}>
        <Unplug className="size-4" />
        Disconnect
      </Button>
    </Confirm>
  );
}
