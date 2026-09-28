import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, CheckCircle2, Plus, ReceiptText } from "lucide-react";
import { getCurrentUser, requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { invoiceNo, jobNo, money } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/money/labels";
import { changeDue } from "@/lib/counter/math";
import { getCounterSale } from "@/lib/counter/queries";
import { stripeConnected } from "@/lib/payments/connection";
import { Card, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { InvoiceStatusBadge } from "@/components/status";
import { Tender } from "../../_components/tender";
import { CancelSaleButton, EmailReceiptButton } from "../../_components/sale-actions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  const s = user && /^\d+$/.test(id) ? await getCounterSale(user.tenantId, Number(id)) : null;
  return { title: s ? `Pay ${invoiceNo(s.inv.number)}` : "Take payment" };
}

/** Take payment on an invoice at the counter (a new counter sale, an open invoice or a job deposit). */
export default async function CounterSalePage({ params }: Props) {
  const user = await requirePagePermission("counter.use");
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const sale = await getCounterSale(user.tenantId, Number(id));
  if (!sale) notFound();
  const { inv, customer } = sale;
  const connected = await stripeConnected(user.tenantId);
  const isVoid = inv.status === "void";
  const balance = isVoid ? 0 : Math.max(0, inv.totalCents - inv.paidCents);
  const active = sale.payments.filter((x) => !x.p.voidedAt);
  const lastCash = [...active].reverse().find((x) => x.p.method === "cash");
  const lastChange = lastCash ? changeDue(lastCash.p) : 0;
  const walkIn = customer.name === "Walk-in";

  return (
    <div>
      <PageHeader
        back={{ href: "/counter", label: "Front counter" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {invoiceNo(inv.number)}
            <InvoiceStatusBadge status={inv.status} />
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3">
            <span className="font-medium text-slate-700">{customer.name}</span>
            {sale.job && (
              <Link href={`/jobs/${sale.job.number}`} className="hover:underline">
                {jobNo(sale.job.number)} · {sale.job.title}
              </Link>
            )}
            {inv.source === "counter" && <span>Counter sale</span>}
          </span>
        }
        actions={
          <>
            {can(user.role, "money.view") && <LinkButton href={`/money/invoices/${inv.id}`}>Invoice details</LinkButton>}
            {inv.source === "counter" && !isVoid && inv.paidCents === 0 && <CancelSaleButton invoiceId={inv.id} />}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-4">
          {isVoid ? (
            <Card className="flex items-start gap-3 p-5">
              <Ban className="size-6 text-slate-500" />
              <div>
                <p className="text-lg font-semibold text-slate-900">This sale was cancelled.</p>
                {inv.voidReason && <p className="text-slate-600">{inv.voidReason}</p>}
              </div>
            </Card>
          ) : balance > 0 ? (
            <>
              <Card className="flex items-baseline justify-between gap-3 px-5 py-3 lg:hidden">
                <p className="text-sm font-medium uppercase tracking-wide text-slate-500">{inv.paidCents > 0 ? "Still to pay" : "Amount due"}</p>
                <p className="text-3xl font-bold tabular text-slate-900">{money(balance)}</p>
              </Card>
              <Tender invoiceId={inv.id} balanceCents={balance} stripe={connected} canSetupStripe={can(user.role, "settings.manage")} customerEmail={customer.email} />
            </>
          ) : (
            <Card className="p-6 text-center">
              <CheckCircle2 className="mx-auto size-16 text-emerald-600" />
              <p className="mt-2 text-3xl font-bold text-emerald-800">Paid in full</p>
              {lastChange > 0 && (
                <div className="mx-auto mt-4 max-w-sm rounded-xl bg-emerald-50 px-4 py-3">
                  <p className="text-sm font-medium text-emerald-800">Change due</p>
                  <p className="text-4xl font-bold tabular text-emerald-800">{money(lastChange)}</p>
                </div>
              )}
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <LinkButton href={`/counter/receipt/${inv.id}?print=1`} size="lg" variant="primary">
                  <ReceiptText className="size-5" />
                  Receipt
                </LinkButton>
                <EmailReceiptButton invoiceId={inv.id} defaultEmail={walkIn ? null : customer.email} />
                <LinkButton href="/counter" size="lg" variant="success">
                  <Plus className="size-5" />
                  New sale
                </LinkButton>
              </div>
            </Card>
          )}
        </div>

        <Card className="lg:sticky lg:top-20 lg:self-start">
          <CardHeader title="Sale" />
          <ul className="divide-y divide-slate-100 text-[15px]">
            {sale.items.map((it) => (
              <li key={it.id} className="flex justify-between gap-3 px-5 py-2.5">
                <span className="min-w-0">
                  {it.quantity > 1 && <span className="tabular text-slate-500">{it.quantity.toLocaleString()} × </span>}
                  {it.description}
                  {!it.taxable && <span className="ml-1 text-xs text-slate-500">(not taxed)</span>}
                </span>
                <span className="tabular">{money(it.amountCents)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 border-t border-slate-200 px-5 py-3 text-[15px]">
            <Row label="Subtotal" value={money(inv.subtotalCents)} />
            <Row label={`Sales tax${inv.taxRate ? ` (${(inv.taxRate * 100).toFixed(2).replace(/\.?0+$/, "")}%)` : customer.taxExempt ? " (exempt)" : ""}`} value={money(inv.taxCents)} />
            <Row label="Total" value={money(inv.totalCents)} strong />
          </dl>
          {sale.payments.length > 0 && (
            <div className="border-t border-slate-200 px-5 py-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Payments</p>
              <ul className="space-y-1 text-[15px]">
                {sale.payments.map(({ p }) => (
                  <li key={p.id} className={p.voidedAt ? "text-slate-400 line-through" : undefined}>
                    <div className="flex justify-between gap-3">
                      <span>
                        {PAYMENT_METHOD_LABELS[p.method]}
                        {p.reference ? <span className="text-slate-500"> · {p.reference}</span> : null}
                      </span>
                      <span className="tabular">−{money(p.amountCents)}</span>
                    </div>
                    {!p.voidedAt && changeDue(p) > 0 && (
                      <p className="text-sm text-slate-500">
                        Cash given {money(p.tenderedCents)} · change {money(changeDue(p))}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-baseline justify-between border-t border-slate-200 px-5 py-3">
            <span className="font-semibold text-slate-900">{balance > 0 && inv.paidCents > 0 ? "Still to pay" : balance > 0 ? "Amount due" : "Balance"}</span>
            <span className={`text-3xl font-bold tabular ${balance > 0 ? "text-slate-900" : "text-emerald-700"}`}>{money(balance)}</span>
          </div>
          {balance > 0 && (
            <div className="border-t border-slate-100 px-3 py-2">
              <LinkButton href={`/counter/receipt/${inv.id}`} variant="ghost" className="w-full">
                <ReceiptText className="size-4" />
                {inv.paidCents > 0 ? "Finish — leave the rest owing" : "Finish without payment"}
              </LinkButton>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "pt-1 text-base font-semibold text-slate-900" : ""}`}>
      <dt className={strong ? undefined : "text-slate-500"}>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
