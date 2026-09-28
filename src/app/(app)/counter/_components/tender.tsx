"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Banknote, CheckCircle2, CreditCard, FileCheck2, Loader2, Mail, QrCode, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input, MoneyInput } from "@/components/ui/input";
import { centsToInput, money, parseMoney } from "@/lib/format";
import { cashPayment, quickCash } from "@/lib/counter/math";
import { cn } from "@/lib/utils";
import { cancelStripeAction, checkStripeAction, emailPayLinkAction, startStripeAction, takePaymentAction, type StripeLinkView } from "../actions";

type Method = "cash" | "check" | "card" | "stripe";

const METHODS: { key: Method; label: string; sub: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "cash", label: "Cash", sub: "Change worked out", icon: Banknote },
  { key: "check", label: "Check", sub: "Check number", icon: FileCheck2 },
  { key: "card", label: "Card", sub: "On your card terminal", icon: CreditCard },
  { key: "stripe", label: "Card by phone", sub: "Customer scans a QR code", icon: Smartphone },
];

export function Tender({
  invoiceId,
  balanceCents,
  stripe,
  canSetupStripe,
  customerEmail,
}: {
  invoiceId: number;
  balanceCents: number;
  stripe: boolean;
  canSetupStripe: boolean;
  customerEmail: string | null;
}) {
  const router = useRouter();
  const [method, setMethod] = React.useState<Method>("cash");
  const [amountText, setAmountText] = React.useState(centsToInput(balanceCents));
  const [cashText, setCashText] = React.useState("");
  const [ref, setRef] = React.useState("");
  const [lastChange, setLastChange] = React.useState<{ applied: number; change: number } | null>(null);
  const [link, setLink] = React.useState<StripeLinkView | null>(null);
  const [pending, start] = React.useTransition();

  // A payment was recorded elsewhere (split, webhook): start the next one from the new balance.
  React.useEffect(() => {
    setAmountText(centsToInput(balanceCents));
    setCashText("");
    setRef("");
  }, [balanceCents]);

  const amount = Math.max(0, parseMoney(amountText) ?? 0);
  const overBalance = amount > balanceCents;
  const tendered = cashText.trim() ? Math.max(0, parseMoney(cashText) ?? 0) : null;
  const cash = cashPayment(amount, tendered ?? amount);

  const record = () => {
    if (method === "stripe") return;
    if (!(amount > 0)) return toast.error("Enter the amount.");
    if (overBalance) return toast.error(`That's more than the ${money(balanceCents)} balance.`);
    if (method === "check" && !ref.trim()) return toast.error("Enter the check number.");
    if (method === "cash" && tendered !== null && tendered <= 0) return toast.error("Enter the cash received.");
    start(async () => {
      const r = await takePaymentAction(invoiceId, { method, amountCents: amount, tenderedCents: method === "cash" ? tendered : null, reference: ref.trim() || null });
      if (!r.ok) return void toast.error(r.error);
      const d = r.data!;
      if (method === "cash") setLastChange({ applied: d.appliedCents, change: d.changeCents });
      toast.success(`${money(d.appliedCents)} ${method === "cash" ? "cash" : method === "check" ? "check" : "card"} recorded`);
      router.refresh();
    });
  };

  const startStripe = () => {
    if (amount < 50) return toast.error("Card payments must be at least $0.50.");
    if (overBalance) return toast.error(`That's more than the ${money(balanceCents)} balance.`);
    start(async () => {
      const r = await startStripeAction(invoiceId, amount);
      if (!r.ok) return void toast.error(r.error);
      setLink(r.data!);
    });
  };

  return (
    <div className="space-y-4">
      {lastChange && lastChange.change > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-emerald-800">Give the customer their change</p>
            <p className="text-3xl font-bold tabular text-emerald-800">{money(lastChange.change)}</p>
          </div>
          <Button variant="ghost" aria-label="Dismiss" onClick={() => setLastChange(null)}>
            <X className="size-5" />
          </Button>
        </div>
      )}

      <Card className="p-4">
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">How are they paying?</p>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {METHODS.map((m) => {
            const off = m.key === "stripe" && !stripe;
            return (
              <button
                key={m.key}
                type="button"
                disabled={off || !!link}
                onClick={() => setMethod(m.key)}
                className={cn(
                  "flex min-h-[4.5rem] flex-col items-start justify-center gap-0.5 rounded-xl border px-4 py-2.5 text-left transition-colors disabled:opacity-50",
                  method === m.key ? "border-brand-500 bg-brand-50 text-brand-800 ring-2 ring-brand-500/20" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
                )}
              >
                <m.icon className="size-6" />
                <span className="text-base font-semibold">{m.label}</span>
                <span className="text-xs text-slate-500">{off ? "Not set up" : m.sub}</span>
              </button>
            );
          })}
        </div>
        {!stripe && (
          <p className="mt-2 text-sm text-slate-500">
            Card by phone (QR code) needs the shop&apos;s Stripe account.{" "}
            {canSetupStripe ? (
              <Link href="/settings/integrations" className="text-brand-600 hover:underline">
                Connect Stripe
              </Link>
            ) : (
              "An owner can connect it in Settings → Integrations."
            )}
          </p>
        )}
      </Card>

      <Card
        className="p-4"
        onKeyDown={(e) => {
          // Enter in a field records the payment (keyboard / number pad at the counter).
          if (e.key === "Enter" && e.target instanceof HTMLInputElement && !pending) {
            e.preventDefault();
            if (method === "stripe") {
              if (!link) startStripe();
            } else record();
          }
        }}
      >
        <Field label="Amount to pay now" htmlFor="pay-amount" hint={overBalance ? <span className="text-red-700">That&apos;s more than the {money(balanceCents)} balance.</span> : amount < balanceCents ? `Leaves ${money(balanceCents - amount)} to pay another way (or later).` : "The whole balance."}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-48">
              <MoneyInput id="pay-amount" value={amountText} onChange={(e) => setAmountText(e.target.value)} className="h-14 text-2xl font-semibold" disabled={!!link} />
            </div>
            <Chip active={amount === balanceCents} onClick={() => setAmountText(centsToInput(balanceCents))} disabled={!!link}>
              Full balance
            </Chip>
            {balanceCents >= 200 && (
              <Chip active={amount === Math.round(balanceCents / 2)} onClick={() => setAmountText(centsToInput(Math.round(balanceCents / 2)))} disabled={!!link}>
                Half ({money(Math.round(balanceCents / 2))})
              </Chip>
            )}
          </div>
        </Field>

        {method === "cash" && (
          <div className="mt-5 space-y-3">
            <Field label="Cash received" htmlFor="pay-cash" hint="Leave blank if they handed over the exact amount.">
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-48">
                  <MoneyInput id="pay-cash" value={cashText} onChange={(e) => setCashText(e.target.value)} placeholder={centsToInput(amount)} className="h-14 text-2xl font-semibold" />
                </div>
                {quickCash(amount).map((c) => (
                  <Chip key={c} active={tendered === c} onClick={() => setCashText(centsToInput(c))}>
                    {c === amount ? "Exact" : money(c, { cents: c % 100 !== 0 })}
                  </Chip>
                ))}
              </div>
            </Field>
            {tendered !== null && tendered > 0 && (
              <div className={cn("rounded-xl px-4 py-3", cash.changeCents > 0 ? "bg-emerald-50 text-emerald-800" : tendered < amount ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-700")}>
                {tendered >= amount ? (
                  <>
                    <p className="text-sm font-medium">Change due</p>
                    <p className="text-4xl font-bold tabular">{money(cash.changeCents)}</p>
                  </>
                ) : (
                  <p className="text-[15px] font-medium">
                    {money(tendered)} is less than {money(amount)}. We&apos;ll record {money(tendered)} cash and {money(balanceCents - tendered)} stays to pay.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        {method === "check" && (
          <Field label="Check number" htmlFor="pay-ref" required className="mt-5">
            <Input id="pay-ref" inputMode="numeric" value={ref} onChange={(e) => setRef(e.target.value)} className="h-14 w-60 text-xl" maxLength={30} placeholder="e.g. 4821" />
          </Field>
        )}
        {method === "card" && (
          <Field label="Last 4 digits of the card" htmlFor="pay-ref" hint="Optional — helps match it to your card terminal's report." className="mt-5">
            <Input id="pay-ref" inputMode="numeric" value={ref} onChange={(e) => setRef(e.target.value.replace(/\D/g, "").slice(0, 4))} className="h-14 w-40 text-xl tabular" placeholder="1234" />
          </Field>
        )}

        {method !== "stripe" ? (
          <Button variant="success" size="lg" className="mt-5 h-16 w-full text-lg" disabled={pending || !(amount > 0) || overBalance} onClick={record}>
            {pending && <Loader2 className="size-5 animate-spin" />}
            {method === "cash" ? `Record ${money(tendered !== null && tendered < amount ? tendered : amount)} cash` : method === "check" ? `Record ${money(amount)} check` : `Record ${money(amount)} card payment`}
          </Button>
        ) : link ? (
          <StripeWait link={link} customerEmail={customerEmail} invoiceId={invoiceId} onDone={() => { setLink(null); router.refresh(); }} onCancel={() => setLink(null)} />
        ) : (
          <Button variant="primary" size="lg" className="mt-5 h-16 w-full text-lg" disabled={pending || amount < 50 || overBalance} onClick={startStripe}>
            {pending ? <Loader2 className="size-5 animate-spin" /> : <QrCode className="size-5" />}
            Show QR code for {money(amount)}
          </Button>
        )}
      </Card>
    </div>
  );
}

function Chip({ active, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn("h-14 rounded-xl border px-4 text-base font-medium tabular disabled:opacity-50", active ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}
      {...props}
    >
      {children}
    </button>
  );
}

/** QR code on screen; checks every few seconds until Stripe says it's paid. */
function StripeWait({ link, customerEmail, invoiceId, onDone, onCancel }: { link: StripeLinkView; customerEmail: string | null; invoiceId: number; onDone: () => void; onCancel: () => void }) {
  const [status, setStatus] = React.useState<"open" | "paid" | "expired">("open");
  const [emailOpen, setEmailOpen] = React.useState(false);
  const [email, setEmail] = React.useState(customerEmail ?? "");
  const [sending, startSend] = React.useTransition();
  const [cancelling, startCancel] = React.useTransition();
  const doneRef = React.useRef(onDone);
  React.useEffect(() => {
    doneRef.current = onDone;
  });

  React.useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const r = await checkStripeAction(link.linkId);
      if (!live) return;
      if (r.ok && r.data) {
        setStatus(r.data.status);
        if (r.data.status === "paid") {
          toast.success(`${money(link.amountCents)} card payment received`);
          setTimeout(() => doneRef.current(), 1200);
          return;
        }
        if (r.data.status === "expired") return;
      }
      timer = setTimeout(tick, 3000);
    };
    timer = setTimeout(tick, 3000);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [link.linkId, link.amountCents]);

  return (
    <div className="mt-5 rounded-xl border border-slate-200 p-4 text-center">
      {status === "paid" ? (
        <div className="py-8">
          <CheckCircle2 className="mx-auto size-16 text-emerald-600" />
          <p className="mt-2 text-2xl font-semibold text-emerald-800">Paid {money(link.amountCents)}</p>
        </div>
      ) : status === "expired" ? (
        <div className="py-6">
          <p className="text-lg font-semibold text-slate-900">This payment link expired.</p>
          <Button size="lg" className="mt-3" onClick={onCancel}>
            Start again
          </Button>
        </div>
      ) : (
        <>
          <p className="text-lg font-semibold text-slate-900">Ask the customer to scan this with their phone camera</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- generated QR code (data URL) */}
          <img src={link.qr} alt="QR code to pay by card" className="mx-auto my-3 size-64 max-w-full rounded-lg bg-white p-2 sm:size-72" />
          <p className="text-3xl font-bold tabular text-slate-900">{money(link.amountCents)}</p>
          <p className="mt-2 flex items-center justify-center gap-2 text-[15px] text-slate-600">
            <Loader2 className="size-4 animate-spin" /> Waiting for the payment… this screen updates by itself.
          </p>
          <p className="mt-2 break-all text-xs text-slate-400">{link.shortUrl}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button size="lg" onClick={() => setEmailOpen(true)}>
              <Mail className="size-4" /> Email a pay link instead
            </Button>
            <Button
              size="lg"
              variant="ghost"
              disabled={cancelling}
              onClick={() =>
                startCancel(async () => {
                  await cancelStripeAction(link.linkId);
                  onCancel();
                })
              }
            >
              Cancel — pay another way
            </Button>
          </div>
        </>
      )}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent title="Email a pay link" description="They get a link to pay the whole balance by card, any time.">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              startSend(async () => {
                const r = await emailPayLinkAction(invoiceId, email);
                if (!r.ok) return void toast.error(r.error);
                toast.success(`Pay link sent to ${r.data!.to}`);
                setEmailOpen(false);
              });
            }}
          >
            <Field label="Customer's email" htmlFor="pl-email" required>
              <Input id="pl-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-12 text-base" autoFocus />
            </Field>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <Button type="submit" variant="primary" disabled={sending}>
                {sending && <Loader2 className="size-4 animate-spin" />}
                Send link
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
