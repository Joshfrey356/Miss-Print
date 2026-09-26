import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { Chips, withParams } from "@/components/chips";
import { InvoiceStatusBadge } from "@/components/status";
import { cn } from "@/lib/utils";
import { daysBetween, fmtDate, invoiceNo, jobNo, money, moneyShort, plural, timeAgo, today } from "@/lib/format";
import { getReceivables } from "@/lib/money/queries";
import { AGING_LABELS, agingBucket, type AgingBucket } from "@/lib/money/service";
import { SendReminderButton } from "./client";
import { Num, type SP } from "./parts";

const BUCKETS: AgingBucket[] = ["current", "1_30", "31_60", "61_90", "90_plus"];
const BUCKET_TONE: Record<AgingBucket, string> = {
  current: "text-slate-900",
  "1_30": "text-amber-700",
  "31_60": "text-orange-700",
  "61_90": "text-red-700",
  "90_plus": "text-red-800",
};

const bucketLabel = (b: AgingBucket) => (b === "current" ? "Current (not due)" : `${AGING_LABELS[b].replace(" days", "")} days late`);

export async function ReceivablesTab({ params, canEdit }: { params: SP; canEdit: boolean }) {
  const now = today();
  const all = (await getReceivables()).map((r) => ({ ...r, bucket: agingBucket(r.dueDate, now), age: Math.max(0, daysBetween(r.dueDate, now)) }));
  const p = { ...params, tab: "receivables" };
  const bucket = BUCKETS.includes(params.bucket as AgingBucket) ? (params.bucket as AgingBucket) : undefined;
  const grouped = params.group === "customer";
  const rows = bucket ? all.filter((r) => r.bucket === bucket) : all;
  const total = all.reduce((a, r) => a + r.balance, 0);

  if (!all.length)
    return (
      <Card>
        <EmptyState icon={CheckCircle2} title="Nothing outstanding" description="Every invoice is paid. Nice." />
      </Card>
    );

  const sums = BUCKETS.map((b) => {
    const list = all.filter((r) => r.bucket === b);
    return { b, cents: list.reduce((a, r) => a + r.balance, 0), count: list.length };
  });

  const customers = grouped
    ? Object.values(
        rows.reduce<Record<number, { customerId: number; customerName: string; balance: number; count: number; oldest: number; lastReminderAt: Date | null }>>((acc, r) => {
          const c = (acc[r.customerId] ??= { customerId: r.customerId, customerName: r.customerName, balance: 0, count: 0, oldest: 0, lastReminderAt: null });
          c.balance += r.balance;
          c.count += 1;
          c.oldest = Math.max(c.oldest, r.age);
          if (r.lastReminderAt && (!c.lastReminderAt || r.lastReminderAt > c.lastReminderAt)) c.lastReminderAt = r.lastReminderAt;
          return acc;
        }, {}),
      ).sort((a, b) => b.oldest - a.oldest || b.balance - a.balance)
    : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Link
          href={withParams("/money", p, { bucket: undefined })}
          className={cn("rounded-xl border bg-white px-4 py-3.5 shadow-sm hover:bg-slate-50", !bucket ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200")}
        >
          <p className="text-sm font-medium text-slate-500">Total outstanding</p>
          <p className="mt-1 text-2xl font-semibold tabular text-slate-900">{moneyShort(total)}</p>
          <p className="text-sm text-slate-500">{plural(all.length, "invoice")}</p>
        </Link>
        {sums.map((s) => (
          <Link
            key={s.b}
            href={withParams("/money", p, { bucket: s.b === bucket ? undefined : s.b })}
            className={cn("rounded-xl border bg-white px-4 py-3.5 shadow-sm hover:bg-slate-50", s.b === bucket ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200")}
          >
            <p className="text-sm font-medium text-slate-500">{bucketLabel(s.b)}</p>
            <p className={cn("mt-1 text-2xl font-semibold tabular", s.cents ? BUCKET_TONE[s.b] : "text-slate-300")}>{moneyShort(s.cents)}</p>
            <p className="text-sm text-slate-500">{plural(s.count, "invoice")}</p>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Chips
          active={grouped ? "customer" : "invoice"}
          items={[
            { key: "invoice", label: "By invoice", href: withParams("/money", p, { group: undefined }) },
            { key: "customer", label: "By customer", href: withParams("/money", p, { group: "customer" }) },
          ]}
        />
        {bucket && (
          <p className="text-sm text-slate-600">
            Showing {bucket === "current" ? "invoices not due yet" : bucketLabel(bucket).toLowerCase()} ·{" "}
            <Link href={withParams("/money", p, { bucket: undefined })} className="text-brand-700 hover:underline">
              Show all
            </Link>
          </p>
        )}
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState compact title="No invoices in this group." />
        ) : grouped ? (
          <Table>
            <THead>
              <tr>
                <Th>Customer</Th>
                <Th className="text-right">Invoices</Th>
                <Th className="text-right">Amount due</Th>
                <Th>Oldest</Th>
                <Th>Last reminder</Th>
              </tr>
            </THead>
            <tbody>
              {customers.map((c) => (
                <Tr key={c.customerId}>
                  <Td>
                    <Link href={withParams("/money", { tab: "invoices", status: "unpaid", q: c.customerName }, {})} className="font-medium text-slate-900 hover:underline">
                      {c.customerName}
                    </Link>
                  </Td>
                  <Td className="text-right">{c.count}</Td>
                  <Td className="text-right">
                    <Num className="font-semibold text-slate-900">{money(c.balance)}</Num>
                  </Td>
                  <Td className={c.oldest > 0 ? "font-medium text-red-700" : "text-slate-600"}>{c.oldest > 0 ? `${c.oldest} days late` : "Not due yet"}</Td>
                  <Td className="text-slate-600">{c.lastReminderAt ? timeAgo(c.lastReminderAt) : "Never"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Customer</Th>
                <Th>Invoice</Th>
                <Th className="text-right">Amount due</Th>
                <Th>Due</Th>
                <Th>Age</Th>
                <Th>Last reminder</Th>
                {canEdit && <Th />}
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id} className="hover:bg-slate-50/70">
                  <Td className="max-w-64">
                    <Link href={`/customers/${r.customerId}`} className="block truncate font-medium text-slate-900 hover:underline">
                      {r.customerName}
                    </Link>
                    {r.customerPhone && <span className="text-sm text-slate-500">{r.customerPhone}</span>}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Link href={`/money/invoices/${r.id}`} className="font-medium text-brand-700 hover:underline">
                      {invoiceNo(r.number)}
                    </Link>
                    {r.jobNumber && <span className="block text-sm text-slate-500">{jobNo(r.jobNumber)}</span>}
                  </Td>
                  <Td className="text-right">
                    <Num className="font-semibold text-slate-900">{money(r.balance)}</Num>
                    {r.status === "partial" && <span className="block text-xs text-slate-500">of {money(r.totalCents)}</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-slate-600">{fmtDate(r.dueDate, { weekday: false, year: true })}</Td>
                  <Td className="whitespace-nowrap">
                    {r.age > 0 ? <span className={cn("font-medium", BUCKET_TONE[r.bucket])}>{r.age} days late</span> : <InvoiceStatusBadge status={r.status} />}
                  </Td>
                  <Td className="whitespace-nowrap text-slate-600">{r.lastReminderAt ? timeAgo(r.lastReminderAt) : <span className="text-slate-400">Never</span>}</Td>
                  {canEdit && (
                    <Td className="text-right">
                      <SendReminderButton invoiceId={r.id} invoiceNumber={r.number} customerName={r.customerName} balanceCents={r.balance} hasEmail={r.hasEmail} />
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
