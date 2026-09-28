import * as React from "react";
import Link from "next/link";
import { AlertCircle, BookOpenCheck, CheckCircle2, CircleDashed, Info, Plug } from "lucide-react";
import { appUrl } from "@/lib/http";
import { fmtDate, fmtDateTime, timeAgo, ymdOf } from "@/lib/format";
import { getQboOverview, type SyncListItem } from "@/lib/accounting/quickbooks/server";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DisconnectButton, QuickBooksFlash, RetryRecordButton, StartDateForm, SyncButtons } from "./quickbooks-controls";

/** QuickBooks Online connection for this shop: connect, sync status, failures with Retry, disconnect. */
export async function QuickBooksCard({ tenantId }: { tenantId: number }) {
  const o = await getQboOverview(tenantId);
  const redirectUri = `${await appUrl()}/api/quickbooks/callback`;
  const conn = o.connection;
  const connected = !!conn?.active;
  const needsReconnect = connected && conn.status === "error";

  const badge = !o.appConfigured ? (
    <Badge tone="gray">
      <CircleDashed className="size-3.5" />
      Not set up
    </Badge>
  ) : needsReconnect ? (
    <Badge tone="red">
      <AlertCircle className="size-3.5" />
      Needs attention
    </Badge>
  ) : connected ? (
    <Badge tone="green">
      <CheckCircle2 className="size-3.5" />
      Connected
    </Badge>
  ) : (
    <Badge tone="red">
      <CircleDashed className="size-3.5" />
      Not connected
    </Badge>
  );

  return (
    <Card id="quickbooks">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <BookOpenCheck className="size-5 text-emerald-600" />
            QuickBooks Online
          </span>
        }
        description="Sends your invoices, payments and the customers on them to your QuickBooks books."
        action={badge}
      />
      <CardBody className="space-y-4">
        <React.Suspense>
          <QuickBooksFlash />
        </React.Suspense>

        {!o.appConfigured ? (
          <NotConfigured redirectUri={redirectUri} />
        ) : !connected ? (
          <NotConnected
            secretsOk={o.secretsOk}
            sandbox={o.serverEnvironment === "sandbox"}
            previous={conn?.config.companyName ?? null}
            previousUntil={conn?.status === "disconnected" ? conn.updatedAt : null}
          />
        ) : (
          <>
            {needsReconnect && (
              <div role="alert" className="flex flex-wrap items-start gap-3 rounded-lg bg-red-50 px-3 py-3 text-[15px] text-red-800">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">QuickBooks stopped accepting our sign-in, so nothing is being sent.</p>
                  {conn.lastError && <p className="mt-0.5 text-sm">{conn.lastError}</p>}
                </div>
                <a href="/api/quickbooks/connect" className={buttonClass("primary", "sm")}>
                  Reconnect
                </a>
              </div>
            )}

            <dl className="grid gap-x-6 gap-y-3 text-[15px] sm:grid-cols-2">
              <Detail label="Company">{conn.config.companyName ?? `QuickBooks company ${conn.config.realmId}`}</Detail>
              <Detail label="Environment">
                {conn.config.environment === "sandbox" ? (
                  <span className="inline-flex items-center gap-2">
                    Sandbox <Badge tone="amber">Test company</Badge>
                  </span>
                ) : (
                  "Live books"
                )}
              </Detail>
              <Detail label="Connected">
                {fmtDate(ymdOf(conn.connectedAt), { year: true, weekday: false })}
                {o.connectedByName ? ` by ${o.connectedByName}` : ""}
              </Detail>
              <Detail label="Last sent">{o.lastSyncAt ? <span title={fmtDateTime(o.lastSyncAt)}>{timeAgo(o.lastSyncAt)}</span> : "Nothing sent yet"}</Detail>
            </dl>

            {o.counts && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="In QuickBooks" value={o.counts.synced} tone="green" />
                <Stat label="Waiting to send" value={o.counts.waiting} tone="gray" />
                <Stat label="Failed" value={o.counts.failed} tone={o.counts.failed ? "red" : "gray"} />
                <Stat label="Notes to check" value={o.counts.notes} tone={o.counts.notes ? "amber" : "gray"} />
              </div>
            )}

            <SyncButtons failed={o.counts?.failed ?? 0} />

            {o.failures.length > 0 && (
              <SyncList title="Couldn't send" tone="red" items={o.failures} retry more={(o.counts?.failed ?? 0) - o.failures.length} />
            )}
            {o.notes.length > 0 && <SyncList title="Sent, with a note" tone="amber" items={o.notes} />}

            <div className="border-t border-slate-100 pt-4">
              <StartDateForm value={conn.config.syncFrom ?? ""} />
              <p className="mt-1.5 text-sm text-slate-500">
                Older invoices (and their payments) stay out of QuickBooks, so anything you already entered there by hand isn&apos;t doubled.
              </p>
            </div>

            <HowItWorks />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <p className="text-sm text-slate-500">QuickBooks Online only — QuickBooks Desktop isn&apos;t supported.</p>
              <DisconnectButton company={conn.config.companyName ?? "QuickBooks"} />
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function NotConfigured({ redirectUri }: { redirectUri: string }) {
  return (
    <div className="space-y-3 text-[15px] text-slate-700">
      <p>
        This server isn&apos;t set up for QuickBooks yet. The person who runs this app&apos;s server does this once; then each shop connects its own
        QuickBooks company here.
      </p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          Create an app at <span className="font-medium">developer.intuit.com</span> with the <span className="font-medium">Accounting</span> scope.
        </li>
        <li>
          In the app&apos;s keys, add this Redirect URI:
          <code className="mt-1 block overflow-x-auto rounded-md bg-slate-100 px-2 py-1.5 font-mono text-sm break-all text-slate-800">{redirectUri}</code>
        </li>
        <li>
          On the server, set <Code>QUICKBOOKS_CLIENT_ID</Code> and <Code>QUICKBOOKS_CLIENT_SECRET</Code> (and <Code>QUICKBOOKS_ENVIRONMENT=sandbox</Code> to try
          it with a test company first), make sure <Code>APP_SECRET_KEY</Code> is set, then restart the app.
        </li>
      </ol>
      <p className="text-sm text-slate-500">
        QuickBooks Online only — QuickBooks Desktop isn&apos;t supported. Until it&apos;s connected, keep entering invoices in QuickBooks as you do today.
      </p>
    </div>
  );
}

function NotConnected({ secretsOk, sandbox, previous, previousUntil }: { secretsOk: boolean; sandbox: boolean; previous: string | null; previousUntil: Date | null }) {
  return (
    <div className="space-y-3 text-[15px] text-slate-700">
      <ul className="list-disc space-y-1.5 pl-5">
        <li>New invoices, payments and voids go to QuickBooks automatically, a few seconds after you save them.</li>
        <li>Customers are matched by name to the ones already in QuickBooks, or added if they&apos;re new.</li>
        <li>Only invoices dated from the day you connect are sent, so nothing you already entered in QuickBooks is doubled. You can change the date.</li>
        <li>QuickBooks stays your official books. Changes you make there don&apos;t come back here.</li>
      </ul>
      {previous && previousUntil && (
        <p className="text-sm text-slate-500">
          Was connected to {previous} until {fmtDate(ymdOf(previousUntil), { year: true, weekday: false })}.
        </p>
      )}
      {sandbox && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Info className="mt-0.5 size-4 shrink-0" />
          This server uses Intuit&apos;s sandbox, so you&apos;ll connect a test company, not real books.
        </p>
      )}
      {!secretsOk && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          The server can&apos;t store the connection securely yet: APP_SECRET_KEY isn&apos;t set. Ask whoever runs the server to set it.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {secretsOk ? (
          <a href="/api/quickbooks/connect" className={buttonClass("primary")}>
            <Plug className="size-4" />
            Connect to QuickBooks
          </a>
        ) : (
          <span className={buttonClass("primary", "md", "pointer-events-none opacity-50")} aria-disabled>
            <Plug className="size-4" />
            Connect to QuickBooks
          </span>
        )}
        <span className="text-sm text-slate-500">You&apos;ll sign in to Intuit and pick your company. Needs a QuickBooks admin.</span>
      </div>
      <p className="text-sm text-slate-500">QuickBooks Online only — QuickBooks Desktop isn&apos;t supported.</p>
    </div>
  );
}

function HowItWorks() {
  return (
    <details className="group rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">
      <summary className="cursor-pointer text-[15px] font-medium text-slate-800">How invoices look in QuickBooks</summary>
      <ul className="mt-2 list-disc space-y-1.5 pl-5">
        <li>
          The invoice number is the same as ours, like <span className="font-medium">INV-7001</span>. Turn on <em>Custom transaction numbers</em> in QuickBooks
          (Account and settings → Sales) so it keeps our numbers.
        </li>
        <li>
          Every line uses one service item, <span className="font-medium">Printing &amp; Services</span> (added for you if it&apos;s missing), with our description,
          quantity and amount.
        </li>
        <li>
          Sales tax: lines are marked taxable or not, and QuickBooks works out the tax from its own settings (Automated Sales Tax). If its total comes out
          different from ours, it shows under &ldquo;Sent, with a note&rdquo; so you can check the rate.
        </li>
        <li>Payments are applied to their invoice. Voiding an invoice or payment here voids it in QuickBooks too.</li>
        <li>Editing a record in QuickBooks doesn&apos;t change it here — make changes in this app.</li>
      </ul>
    </details>
  );
}

function SyncList({ title, tone, items, retry, more = 0 }: { title: string; tone: "red" | "amber"; items: SyncListItem[]; retry?: boolean; more?: number }) {
  return (
    <div>
      <h3 className={`text-[15px] font-semibold ${tone === "red" ? "text-red-800" : "text-amber-900"}`}>{title}</h3>
      <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {items.map((f) => (
          <li key={`${f.type}:${f.id}`} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5">
            <div className="min-w-0 flex-1 basis-60">
              <Link href={f.href} className="font-medium text-brand-700 hover:underline">
                {f.label}
              </Link>
              <p className="mt-0.5 text-sm break-words text-slate-600">{f.error}</p>
              {retry && (
                <p className="mt-0.5 text-xs text-slate-400">
                  Tried {f.attempts === 1 ? "once" : `${f.attempts} times`} · last {timeAgo(f.updatedAt)}
                </p>
              )}
            </div>
            {retry && <RetryRecordButton type={f.type} id={f.id} />}
          </li>
        ))}
      </ul>
      {more > 0 && <p className="mt-1.5 text-sm text-slate-500">…and {more} more. &ldquo;Retry&rdquo; above tries them all.</p>}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="font-medium break-words text-slate-900">{children}</dd>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "green" | "gray" | "red" | "amber" }) {
  const color = { green: "text-emerald-700", gray: "text-slate-900", red: "text-red-700", amber: "text-amber-800" }[tone];
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value.toLocaleString()}</p>
      <p className="text-sm text-slate-600">{label}</p>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[13px] text-slate-800">{children}</code>;
}
