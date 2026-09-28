import { AlertTriangle, CheckCircle2, CircleDashed, CreditCard } from "lucide-react";
import { appUrl } from "@/lib/http";
import { fmtDateTime } from "@/lib/format";
import { secretsConfigured } from "@/lib/secrets";
import { getStripeStatus } from "@/lib/payments/connection";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CopyField, StripeConnectForm, StripeDisconnectButton } from "./stripe-connect-form";

/** Card payments through the shop's own Stripe account: connect, status, disconnect. */
export async function StripeCard({ tenantId }: { tenantId: number }) {
  const [status, base] = await Promise.all([getStripeStatus(tenantId), appUrl()]);
  const webhookUrl = `${base}/api/stripe/webhook/${tenantId}`;
  const canStore = secretsConfigured();

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-violet-50 p-2 text-violet-700">
            <CreditCard className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Stripe — card payments</h2>
            <p className="text-[15px] text-slate-600">Customers pay by card on their phone (QR code at the counter) or from a “Pay online” link in their invoice emails.</p>
          </div>
        </div>
        {status.connected ? (
          status.status === "error" ? (
            <Badge tone="red">
              <AlertTriangle className="size-3.5" /> Needs attention
            </Badge>
          ) : (
            <Badge tone="green">
              <CheckCircle2 className="size-3.5" /> Connected{status.config.livemode ? "" : " · test mode"}
            </Badge>
          )
        ) : (
          <Badge tone="gray">
            <CircleDashed className="size-3.5" /> Not connected
          </Badge>
        )}
      </div>

      {!canStore && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[15px] text-amber-900">
          <p className="font-medium">This server can&apos;t store payment keys yet.</p>
          <p className="mt-0.5 text-sm">
            Whoever runs the server needs to set <code className="rounded bg-white px-1">APP_SECRET_KEY</code> (a long random value that never changes), then restart it. Keys are encrypted with it before they&apos;re saved.
          </p>
        </div>
      )}

      {status.connected && (
        <dl className="mt-4 grid gap-x-6 gap-y-1.5 text-[15px] sm:grid-cols-[10rem_1fr]">
          <dt className="text-slate-500">Stripe account</dt>
          <dd className="text-slate-900">{status.config.accountName ?? (status.config.checked ? "Connected with a restricted key" : "Not checked yet")}</dd>
          <dt className="text-slate-500">Mode</dt>
          <dd className="text-slate-900">{status.config.livemode ? "Live — real cards are charged" : "Test mode — no real money moves"}</dd>
          <dt className="text-slate-500">Key</dt>
          <dd className="font-mono text-sm text-slate-900">{status.config.keyHint}</dd>
          <dt className="text-slate-500">Connected</dt>
          <dd className="text-slate-900">
            {fmtDateTime(status.connectedAt)}
            {status.connectedByName ? ` by ${status.connectedByName}` : ""}
          </dd>
          {status.lastError && (
            <>
              <dt className="text-red-700">Problem</dt>
              <dd className="font-medium text-red-700">{status.lastError}</dd>
            </>
          )}
        </dl>
      )}

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <p className="text-sm font-semibold text-slate-900">{status.connected ? "Webhook (already set up in Stripe)" : "How to connect"}</p>
        {!status.connected && (
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>
              In your Stripe Dashboard, open <strong>Developers → API keys</strong> and copy the <strong>Secret key</strong>.
            </li>
            <li>
              Open <strong>Developers → Webhooks → Add endpoint</strong>. Paste the address below, choose the event <code className="rounded bg-white px-1">checkout.session.completed</code>, and save.
            </li>
            <li>
              On that endpoint, reveal the <strong>Signing secret</strong> (whsec_…) and copy it.
            </li>
            <li>Paste both below and press Connect Stripe.</li>
          </ol>
        )}
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Endpoint URL</p>
          <CopyField value={webhookUrl} label="webhook URL" />
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Event to send</p>
          <CopyField value="checkout.session.completed" label="event name" />
        </div>
        {base.startsWith("http://localhost") && <p className="mt-2 text-xs text-amber-700">This address is on this computer only — Stripe can&apos;t reach it. Set APP_URL to the app&apos;s public address. (Payments are still picked up while the counter screen waits.)</p>}
      </div>

      <div className="mt-5 flex flex-wrap items-start gap-2">
        {status.connected ? (
          <>
            <StripeConnectForm replacing disabled={!canStore} />
            <StripeDisconnectButton />
          </>
        ) : (
          <div className="w-full">
            <StripeConnectForm disabled={!canStore} />
          </div>
        )}
      </div>
    </Card>
  );
}
