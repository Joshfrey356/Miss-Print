import Link from "next/link";
import { requirePagePermission } from "@/lib/auth";
import { money, pct, plural } from "@/lib/format";
import { marginOf } from "@/lib/pricing/engine";
import * as q from "@/lib/reports/queries";
import { rangeQuery, resolveRange, type DateRange } from "@/lib/reports/range";
import { getReportCtx, jobProfitsFor, type ReportCtx, type TabKey } from "@/lib/reports/registry";
import { PageHeader } from "@/components/ui/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import { RangePicker } from "./_components/range-picker";
import { ReportCard, Stat, StatRow } from "./_components/parts";

export const metadata = { title: "Reports" };

type SP = { tab?: string; range?: string; from?: string; to?: string };

const TABS: { key: TabKey; label: string; allowed: (c: ReportCtx) => boolean }[] = [
  { key: "revenue", label: "Revenue", allowed: (c) => c.financial },
  { key: "profit", label: "Profit", allowed: (c) => c.margins },
  { key: "operations", label: "Operations", allowed: () => true },
  { key: "sales", label: "Sales & Quotes", allowed: () => true },
  { key: "customers", label: "Customers", allowed: () => true },
];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePagePermission("reports.basic");
  const sp = await searchParams;
  const ctx = await getReportCtx(user.role);
  const tabs = TABS.filter((t) => t.allowed(ctx));
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? tabs[0]!.key;
  const range = resolveRange(sp);
  const query = { tab, ...rangeQuery(range) };
  const props = { range, ctx, query };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Reports" subtitle={range.label} />
      <RangePicker range={range} tab={tab} />
      <LinkTabs active={tab} tabs={tabs.map((t) => ({ key: t.key, label: t.label, href: `/reports?${new URLSearchParams({ ...rangeQuery(range), tab: t.key })}` }))} />
      {tab === "revenue" && <RevenueTab {...props} />}
      {tab === "profit" && <ProfitTab {...props} />}
      {tab === "operations" && <OperationsTab {...props} />}
      {tab === "sales" && <SalesTab {...props} />}
      {tab === "customers" && <CustomersTab {...props} />}
    </div>
  );
}

type TabProps = { range: DateRange; ctx: ReportCtx; query: Record<string, string> };

async function RevenueTab(p: TabProps) {
  const t = await q.revenueTotals(p.range);
  return (
    <>
      <StatRow>
        <Stat label="Revenue" value={money(t.cents, { cents: false })} sub="Before sales tax" />
        <Stat label="Invoices" value={t.invoices.toLocaleString()} />
        <Stat label="Average invoice" value={t.invoices ? money(t.cents / t.invoices, { cents: false }) : "—"} />
        <Stat label="Customers billed" value={t.customers.toLocaleString()} />
      </StatRow>
      <div className="space-y-6">
        <ReportCard id="revenue_month" {...p} />
        <ReportCard id="revenue_category" {...p} />
        <ReportCard id="revenue_customer" {...p} />
        <ReportCard id="revenue_salesperson" {...p} />
        <ReportCard id="revenue_location" {...p} />
      </div>
    </>
  );
}

async function ProfitTab(p: TabProps) {
  const [jobs, unlinked] = await Promise.all([jobProfitsFor(p.range.from, p.range.to, p.ctx.laborRateCents), q.unlinkedRevenue(p.range)]);
  const revenue = jobs.reduce((s, j) => s + j.revenueCents, 0);
  const cost = jobs.reduce((s, j) => s + j.costCents, 0);
  const margin = marginOf(revenue, cost);
  return (
    <>
      <StatRow>
        <Stat label="Revenue from jobs" value={money(revenue, { cents: false })} sub={plural(jobs.length, "invoiced job")} />
        <Stat label="Actual cost" value={money(cost, { cents: false })} sub="Expenses + labor" />
        <Stat label="Gross profit" value={money(revenue - cost, { cents: false })} />
        <Stat
          label="Margin"
          value={pct(margin)}
          sub={`Target ${pct(p.ctx.targetMarginPct)}`}
          tone={margin == null ? "default" : margin < p.ctx.targetMarginPct ? "bad" : "good"}
        />
      </StatRow>
      {unlinked.count > 0 && (
        <p className="mb-4 rounded-lg bg-slate-100 px-4 py-2.5 text-[15px] text-slate-700">
          {plural(unlinked.count, "invoice")} ({money(unlinked.cents, { cents: false })}) aren&apos;t linked to a job, so they&apos;re not counted here.
        </p>
      )}
      <div className="space-y-6">
        <ReportCard id="profit_category" {...p} />
        <ReportCard id="profit_lowest" {...p} />
        <ReportCard id="profit_customer" {...p} />
      </div>
    </>
  );
}

async function OperationsTab(p: TabProps) {
  const [s, overdue, proofs] = await Promise.all([q.completionSummary(p.range), q.overdueJobs(1), q.outstandingProofs()]);
  const onTime = s.withDue ? s.onTime / s.withDue : null;
  return (
    <>
      <StatRow>
        <Stat label="Jobs completed" value={s.completed.toLocaleString()} />
        <Stat label="Average turnaround" value={s.avgDays == null ? "—" : `${s.avgDays.toFixed(1)} days`} sub="Created → completed" />
        <Stat label="Done by the due date" value={pct(onTime)} sub={s.withDue ? `${s.onTime} of ${s.withDue} jobs` : undefined} />
        <Stat
          label="Overdue right now"
          value={overdue.count.toLocaleString()}
          sub={proofs.length ? `${plural(proofs.length, "proof")} waiting on customers` : "No proofs waiting"}
          tone={overdue.count ? "bad" : "good"}
          href="/jobs?view=overdue"
        />
      </StatRow>
      <div className="space-y-6">
        <ReportCard
          id="ops_overdue"
          {...p}
          action={
            overdue.count > 0 ? (
              <Link href="/jobs?view=overdue" className="text-sm font-medium text-brand-700 hover:underline">
                Open in Jobs
              </Link>
            ) : undefined
          }
        />
        <ReportCard id="ops_proofs" {...p} />
        <ReportCard id="ops_completed_month" {...p} />
        <ReportCard id="ops_turnaround" {...p} />
      </div>
    </>
  );
}

async function SalesTab(p: TabProps) {
  const [s, open] = await Promise.all([q.quoteSummary(p.range), q.openQuotesNow()]);
  const $ = p.ctx.financial;
  return (
    <>
      <StatRow>
        <Stat label="Win rate" value={pct(s.winRate)} sub={s.won + s.lost ? `${s.won} won of ${s.won + s.lost} decided` : "No quotes decided yet"} />
        <Stat label="Quotes won" value={s.won.toLocaleString()} sub={$ ? money(s.wonCents, { cents: false }) : undefined} />
        <Stat label="Quotes lost" value={s.lost.toLocaleString()} sub={$ ? money(s.lostCents, { cents: false }) : undefined} />
        <Stat
          label="Open quotes right now"
          value={(open.sent + open.draft).toLocaleString()}
          sub={
            <>
              {open.sent} sent, {open.draft} draft{$ ? ` · ${money(open.sentCents + open.draftCents, { cents: false })}` : ""}
              {open.oldSent > 0 && <span className="block text-amber-700">{open.oldSent} sent over a week ago — worth a call</span>}
            </>
          }
          href="/quotes"
        />
      </StatRow>
      <div className="space-y-6">
        <ReportCard id="sales_people" {...p} />
        <ReportCard id="sales_lost" {...p} />
      </div>
    </>
  );
}

async function CustomersTab(p: TabProps) {
  const [rep, inactive] = await Promise.all([q.repeatCustomers(p.range), q.inactiveCustomers(50)]);
  return (
    <>
      <StatRow>
        <Stat label="Customers with jobs" value={rep.customers.toLocaleString()} sub="Started a job in this period" />
        <Stat label="Came back for more" value={pct(rep.pct)} sub={rep.customers ? `${rep.repeat} had 2 or more jobs` : undefined} />
        <Stat label="People to call" value={inactive.length.toLocaleString()} sub="No order in 6+ months" tone={inactive.length ? "bad" : "default"} />
      </StatRow>
      <div className="space-y-6">
        <ReportCard id="cust_inactive" {...p} />
        <ReportCard id="cust_top" {...p} />
      </div>
    </>
  );
}
