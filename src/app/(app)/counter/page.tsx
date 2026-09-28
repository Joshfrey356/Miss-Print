import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { Calculator, Printer, ChevronRight, FileText, Hammer, ReceiptText, Search, Settings2 } from "lucide-react";
import { requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { pricingRules } from "@/lib/db/schema";
import { getCategories } from "@/lib/lookups";
import { getSettings } from "@/lib/settings";
import { fmtDate, fmtTime, invoiceNo, jobNo, money, quoteNo, today } from "@/lib/format";
import { getJobPrefix } from "@/lib/tenant";
import { PAYMENT_METHOD_LABELS } from "@/lib/money/labels";
import { STATUS_LABELS } from "@/lib/jobs/workflow";
import type { PricingConfig } from "@/lib/pricing/engine";
import { dayTotals } from "@/lib/counter/math";
import { counterPrintOptions, PRINT_QUANTITIES } from "@/lib/counter/print";
import { loadPrintCatalog } from "@/lib/pricing/server";
import { daySales, dayPayments, lastReceipt, searchPayables } from "@/lib/counter/queries";
import { stripeConnected } from "@/lib/payments/connection";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import { InvoiceStatusBadge } from "@/components/status";
import { SaleBuilder, type CounterCategory } from "./_components/sale-builder";
import { DepositButton } from "./_components/deposit-button";

export const metadata: Metadata = { title: "Front counter" };

type Props = { searchParams: Promise<{ tab?: string; q?: string }> };

export default async function CounterPage({ searchParams }: Props) {
  const user = await requirePagePermission("counter.use");
  const sp = await searchParams;
  const tab = sp.tab === "pay" || sp.tab === "today" ? sp.tab : "sale";
  const now = today();
  const [todayPays, connected, last] = await Promise.all([dayPayments(user.tenantId, now), stripeConnected(user.tenantId), lastReceipt(user.tenantId, user.id)]);

  return (
    <div>
      <PageHeader
        title="Front counter"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {fmtDate(now, { year: true })}
            {connected ? <Badge tone="green">Card payments by phone: on</Badge> : can(user.role, "settings.manage") ? (
              <Link href="/settings/integrations" className="text-sm text-brand-600 hover:underline">
                Set up card payments by phone
              </Link>
            ) : null}
          </span>
        }
        actions={
          <>
            {last && (
              <LinkButton href={`/counter/receipt/${last.invoiceId}?print=1`} size="lg" title={`Your last receipt: ${invoiceNo(last.number)}`}>
                <Printer className="size-5" />
                <span>
                  Reprint last receipt <span className="font-normal text-slate-500">· {invoiceNo(last.number)}</span>
                </span>
              </LinkButton>
            )}
            <LinkButton href="/counter/close" size="lg">
              <Calculator className="size-5" />
              End of day
            </LinkButton>
          </>
        }
      />
      <LinkTabs
        active={tab}
        tabs={[
          { key: "sale", label: "New sale", href: "/counter" },
          { key: "pay", label: "Take a payment", href: "/counter?tab=pay" },
          { key: "today", label: "Today", href: "/counter?tab=today", count: todayPays.length },
        ]}
      />
      {tab === "sale" && <NewSaleTab tenantId={user.tenantId} canCreateJobs={can(user.role, "jobs.create")} now={now} />}
      {tab === "pay" && <PayTab tenantId={user.tenantId} q={sp.q} canQuotes={can(user.role, "quotes.edit") && can(user.role, "jobs.create")} />}
      {tab === "today" && <TodayTab tenantId={user.tenantId} now={now} pays={todayPays} />}
    </div>
  );
}

async function NewSaleTab({ tenantId, canCreateJobs, now }: { tenantId: number; canCreateJobs: boolean; now: string }) {
  const [cats, rules, { rules: biz }, catalog] = await Promise.all([
    getCategories(tenantId),
    db.select({ categoryId: pricingRules.categoryId, config: pricingRules.config }).from(pricingRules).where(eq(pricingRules.tenantId, tenantId)),
    getSettings(tenantId),
    loadPrintCatalog(tenantId),
  ]);
  const categories: CounterCategory[] = cats.map((c) => {
    const config = (rules.find((r) => r.categoryId === c.id)?.config as PricingConfig | undefined) ?? { method: c.pricingMethod };
    const m = config.method ?? c.pricingMethod;
    const kind: CounterCategory["kind"] =
      m === "sheet_fed" ? "print" : m === "quantity_tier" && config.tiers?.length ? "tier" : m === "per_unit" ? "unit" : m === "per_sqft" ? "sqft" : "manual";
    const quickQty =
      kind === "print"
        ? PRINT_QUANTITIES
        : kind === "tier"
          ? [...new Set(config.tiers!.map((t) => t.minQty).filter((q) => q > 0))].sort((a, b) => a - b).slice(0, 6)
          : kind === "sqft"
            ? [1, 2, 3, 4, 5, 10]
            : [1, 2, 5, 10, 25, 50, 100];
    // Paper names only — costs stay on the server.
    const print = kind === "print" ? counterPrintOptions(config.print ?? {}, catalog.papers.map((p) => ({ id: p.id, name: p.name }))) : null;
    return { id: c.id, name: c.name, group: c.group, kind, quickQty, print };
  });
  return <SaleBuilder categories={categories} taxRate={biz.taxRate} canCreateJobs={canCreateJobs} today={now} />;
}

async function PayTab({ tenantId, q, canQuotes }: { tenantId: number; q?: string; canQuotes: boolean }) {
  const [{ openInvoices, uninvoicedJobs, openQuotes }, prefix] = await Promise.all([searchPayables(tenantId, q), getJobPrefix(tenantId)]);
  const nothing = !openInvoices.length && !uninvoicedJobs.length && !openQuotes.length;
  const row = "flex min-h-16 items-center gap-3 px-4 py-3";
  return (
    <div className="space-y-5">
      <form className="flex gap-2" action="/counter">
        <input type="hidden" name="tab" value="pay" />
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
          <input
            name="q"
            defaultValue={q}
            autoFocus
            placeholder="Customer name, invoice # (INV-1234), job # or quote #"
            className="h-14 w-full rounded-xl border border-slate-300 bg-white pl-11 pr-3 text-lg shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <button type="submit" className="h-14 rounded-xl bg-brand-500 px-6 text-lg font-semibold text-white hover:bg-brand-600">
          Find
        </button>
      </form>
      {q && nothing && <EmptyState icon={Search} title={`Nothing open matches “${q}”.`} description="Check the spelling, or search by the customer's name." />}

      {openInvoices.length > 0 && (
        <Card>
          <CardHeader title={q ? "Open invoices" : "Recent open invoices"} description="Take a payment toward the balance." />
          <ul className="divide-y divide-slate-100">
            {openInvoices.map((i) => (
              <li key={i.id}>
                <Link href={`/counter/sale/${i.id}`} className={`${row} hover:bg-slate-50`}>
                  <ReceiptText className="size-5 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium text-slate-900">
                      {invoiceNo(i.number)} · {i.customerName}
                    </p>
                    <p className="truncate text-sm text-slate-500">
                      {i.jobNumber ? `${jobNo(i.jobNumber, prefix)} · ${i.jobTitle}` : i.source === "counter" ? "Counter sale" : ""} · issued {fmtDate(i.issueDate)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular text-slate-900">{money(i.totalCents - i.paidCents)}</p>
                    <InvoiceStatusBadge status={i.status} overdue={i.dueDate < today()} />
                  </div>
                  <ChevronRight className="size-5 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {uninvoicedJobs.length > 0 && (
        <Card>
          <CardHeader title={q ? "Jobs without an invoice" : "Recent jobs without an invoice"} description="Take a deposit: the job's invoice is made, then you take part (or all) of it." />
          <ul className="divide-y divide-slate-100">
            {uninvoicedJobs.map((j) => (
              <li key={j.id} className={row}>
                <Hammer className="size-5 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-slate-900">
                    {jobNo(j.number, prefix)} · {j.title}
                  </p>
                  <p className="truncate text-sm text-slate-500">
                    {j.customerName} · {STATUS_LABELS[j.status]}
                  </p>
                </div>
                <p className="text-lg font-semibold tabular text-slate-900">{money(j.totalCents)}</p>
                <DepositButton kind="job" id={j.id} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {openQuotes.length > 0 && (
        <Card>
          <CardHeader title={q ? "Quotes" : "Quotes waiting on the customer"} description="Taking a deposit turns the quote into a job." />
          <ul className="divide-y divide-slate-100">
            {openQuotes.map((qt) => (
              <li key={qt.id} className={row}>
                <FileText className="size-5 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-slate-900">
                    {quoteNo(qt.number)} · {qt.title}
                  </p>
                  <p className="truncate text-sm text-slate-500">
                    {qt.customerName} · {qt.status === "accepted" ? "Accepted" : "Sent"}
                  </p>
                </div>
                <p className="text-lg font-semibold tabular text-slate-900">{money(qt.totalCents)}</p>
                {canQuotes ? <DepositButton kind="quote" id={qt.id} /> : <span className="text-sm text-slate-400">Convert to a job first</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {!q && nothing && <EmptyState icon={ReceiptText} title="No open invoices, jobs or quotes to take a payment on." />}
    </div>
  );
}

async function TodayTab({ tenantId, now, pays }: { tenantId: number; now: string; pays: Awaited<ReturnType<typeof dayPayments>> }) {
  const [sales, prefix] = await Promise.all([daySales(tenantId, now), getJobPrefix(tenantId)]);
  const d = dayTotals(pays.map((p) => ({ method: p.method, amountCents: p.amountCents })));
  const methods = Object.keys(d.totals) as (keyof typeof PAYMENT_METHOD_LABELS)[];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Taken today" value={money(d.allCents)} sub={`${pays.length} payment${pays.length === 1 ? "" : "s"}`} strong />
        {(["cash", "check", "card"] as const).map((m) => (
          <Stat key={m} label={PAYMENT_METHOD_LABELS[m]} value={money(d.totals[m] ?? 0)} sub={`${d.counts[m] ?? 0} payment${(d.counts[m] ?? 0) === 1 ? "" : "s"}`} />
        ))}
        {methods
          .filter((m) => !["cash", "check", "card"].includes(m))
          .map((m) => (
            <Stat key={m} label={PAYMENT_METHOD_LABELS[m]} value={money(d.totals[m] ?? 0)} sub={`${d.counts[m]} payment${d.counts[m] === 1 ? "" : "s"}`} />
          ))}
      </div>

      <Card>
        <CardHeader title="Counter sales today" description={sales.length ? undefined : "No counter sales yet today."} />
        {sales.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {sales.map((s) => (
              <li key={s.id}>
                <Link href={s.status === "paid" || s.status === "void" ? `/counter/receipt/${s.id}` : `/counter/sale/${s.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                  <span className="w-16 shrink-0 text-sm tabular text-slate-500">{fmtTime(s.createdAt)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">
                      {invoiceNo(s.number)} · {s.customerName}
                    </p>
                    <p className="truncate text-sm text-slate-500">
                      {s.createdByName ?? "—"}
                      {s.jobNumber ? ` · ${jobNo(s.jobNumber, prefix)} on the board` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular">{money(s.totalCents)}</p>
                    <InvoiceStatusBadge status={s.status} />
                  </div>
                  <ChevronRight className="size-5 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Payments today" description={pays.length ? "Every payment recorded today, at the counter or not." : "No payments yet today."} />
        {pays.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {pays.map((p) => (
              <li key={p.id}>
                <Link href={`/counter/receipt/${p.invoiceId}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                  <span className="w-16 shrink-0 text-sm tabular text-slate-500">{fmtTime(p.createdAt)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">
                      {PAYMENT_METHOD_LABELS[p.method]}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </p>
                    <p className="truncate text-sm text-slate-500">
                      {invoiceNo(p.invoiceNumber)} · {p.customerName} · {p.recordedByName ?? (p.processorRef ? "Paid online" : "—")}
                    </p>
                  </div>
                  <p className="font-semibold tabular">{money(p.amountCents)}</p>
                  <ChevronRight className="size-5 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="flex items-center gap-1.5 text-sm text-slate-500">
        <Settings2 className="size-4" /> Voided payments aren&apos;t counted. At closing time, use <Link href="/counter/close" className="text-brand-600 hover:underline">End of day</Link> to count the drawer.
      </p>
    </div>
  );
}

function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <Card className={`p-4 ${strong ? "border-brand-200 bg-brand-50/40" : ""}`}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular text-slate-900">{value}</p>
      {sub && <p className="text-sm text-slate-500">{sub}</p>}
    </Card>
  );
}

