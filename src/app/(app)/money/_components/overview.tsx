import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, FileWarning } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { JobStatusBadge } from "@/components/status";
import { dueLabel, invoiceNo, jobNo, money, moneyShort, pct, plural, timeAgo } from "@/lib/format";
import { getOverview } from "@/lib/money/queries";
import { monthLabel } from "@/lib/money/labels";
import { marginOf } from "@/lib/pricing/engine";
import { CreateInvoiceButton } from "./client";
import { Num, StatCard } from "./parts";

export async function OverviewTab({ canEdit, canMargins }: { canEdit: boolean; canMargins: boolean }) {
  const o = await getOverview();
  const month = monthLabel(o.ym);
  const maxBar = Math.max(1, ...o.months.flatMap((m) => [m.revenue, m.expenses]));
  const gpMargin = marginOf(o.sales, o.jobCost + o.laborCost);
  const nothing = !o.overdueList.length && !o.uninvoiced.length && !o.dueSoonList.length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Sales this month" value={moneyShort(o.sales)} sub={`${plural(o.invoiceCount, "invoice")}, pre-tax`} href="/money?tab=invoices" />
        <StatCard label="Cash collected" value={moneyShort(o.cash)} sub={plural(o.paymentCount, "payment")} tone="green" href="/money?tab=payments" />
        <StatCard label="Expenses this month" value={moneyShort(o.expenses)} sub={plural(o.expenseCount, "expense")} href={`/money?tab=expenses&month=${o.ym}`} />
        {canMargins ? (
          <StatCard
            label="Est. gross profit"
            value={moneyShort(o.grossProfit)}
            sub={gpMargin != null ? `${pct(gpMargin)} margin, estimated` : "estimated"}
            tone={o.grossProfit < 0 ? "red" : "default"}
            href="/money?tab=profitability"
          />
        ) : (
          <StatCard label="Open invoices" value={o.openCount} sub="waiting for payment" href="/money?tab=invoices&status=unpaid" />
        )}
        <StatCard label="Outstanding" value={moneyShort(o.outstanding)} sub={`${plural(o.openCount, "open invoice")}`} href="/money?tab=receivables" />
        <StatCard
          label="Overdue"
          value={moneyShort(o.overdue)}
          sub={o.overdueCount ? plural(o.overdueCount, "invoice") + " past due" : "Nothing past due"}
          tone={o.overdue > 0 ? "red" : "green"}
          href="/money?tab=invoices&status=overdue"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Needs attention"
            description={nothing ? undefined : "Money waiting on us — oldest first."}
          />
          {nothing ? (
            <EmptyState icon={CheckCircle2} title="All caught up" description="No overdue invoices, and every finished job has been invoiced." />
          ) : (
            <div className="divide-y divide-slate-100">
              {o.uninvoiced.length > 0 && (
                <Section icon={FileWarning} tone="amber" title={`Ready to invoice (${o.uninvoiced.length})`} note="Finished or handed-over jobs with no invoice yet.">
                  {o.uninvoiced.map((j) => (
                    <Row key={j.id}>
                      <div className="min-w-0 flex-1 basis-full sm:basis-0">
                        <Link href={`/jobs/${j.number}`} className="font-medium text-slate-900 hover:underline">
                          {jobNo(j.number)} · {j.title}
                        </Link>
                        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                          {j.customerName} <JobStatusBadge status={j.status} />
                          {j.completedAt && <span>Completed {timeAgo(j.completedAt)}</span>}
                        </p>
                      </div>
                      <Num className="ml-auto font-medium text-slate-800 sm:ml-0">{money(j.totalCents)}</Num>
                      {canEdit && <CreateInvoiceButton jobId={j.id} />}
                    </Row>
                  ))}
                </Section>
              )}
              {o.overdueList.length > 0 && (
                <Section icon={AlertTriangle} tone="red" title={`Overdue (${o.overdueCount})`} note={o.overdueCount > o.overdueList.length ? <Link className="text-brand-700 hover:underline" href="/money?tab=receivables">See all in Receivables</Link> : undefined}>
                  {o.overdueList.map((i) => (
                    <InvoiceLine key={i.id} i={i} late />
                  ))}
                </Section>
              )}
              {o.dueSoonList.length > 0 && (
                <Section icon={CalendarClock} tone="blue" title={`Due this week (${o.dueSoonList.length})`}>
                  {o.dueSoonList.map((i) => (
                    <InvoiceLine key={i.id} i={i} />
                  ))}
                </Section>
              )}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Last 6 months" description="Sales (before tax) compared with all expenses." />
          <CardBody className="space-y-4">
            <div className="flex gap-4 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded-sm bg-brand-500" /> Sales
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded-sm bg-amber-400" /> Expenses
              </span>
            </div>
            {o.months.map((m) => (
              <div key={m.ym} className="grid grid-cols-[3rem_1fr] items-center gap-3">
                <span className={`text-sm font-medium ${m.ym === o.ym ? "text-slate-900" : "text-slate-500"}`}>{monthLabel(m.ym, true)}</span>
                <div className="space-y-1">
                  <Bar value={m.revenue} max={maxBar} className="bg-brand-500" />
                  <Bar value={m.expenses} max={maxBar} className="bg-amber-400" />
                </div>
              </div>
            ))}
            <p className="text-xs text-slate-500">{month} is month-to-date.</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${className}`} style={{ width: `${Math.max(value > 0 ? 1.5 : 0, (value / max) * 100)}%` }} />
      </div>
      <Num className="w-16 text-right text-xs text-slate-600">{moneyShort(value)}</Num>
    </div>
  );
}

function Section({ icon: Icon, tone, title, note, children }: { icon: typeof AlertTriangle; tone: "red" | "amber" | "blue"; title: string; note?: React.ReactNode; children: React.ReactNode }) {
  const c = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-brand-600";
  return (
    <div className="px-5 py-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
          <Icon className={`size-4 ${c}`} />
          {title}
        </h3>
        {note && <span className="text-sm text-slate-500">{note}</span>}
      </div>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <li className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg py-2">{children}</li>;
}

function InvoiceLine({ i, late }: { i: { id: number; number: number; dueDate: string; balance: number; customerName: string; jobNumber: number | null }; late?: boolean }) {
  return (
    <Row>
      <div className="min-w-0 flex-1">
        <Link href={`/money/invoices/${i.id}`} className="font-medium text-slate-900 hover:underline">
          {invoiceNo(i.number)} · {i.customerName}
        </Link>
        <p className="text-sm text-slate-500">
          {i.jobNumber ? `${jobNo(i.jobNumber)} · ` : ""}
          <span className={late ? "font-medium text-red-700" : ""}>{late ? dueLabel(i.dueDate) : `Due ${dueLabel(i.dueDate)}`}</span>
        </p>
      </div>
      <Num className="font-semibold text-slate-900">{money(i.balance)}</Num>
    </Row>
  );
}
