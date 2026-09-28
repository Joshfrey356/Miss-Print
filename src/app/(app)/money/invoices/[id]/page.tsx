import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, CreditCard, History, Mail, Store } from "lucide-react";
import { getCurrentUser, requirePagePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { getBrand } from "@/lib/brand";
import { Logo } from "@/components/logo";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { InvoiceStatusBadge } from "@/components/status";
import { dueLabel, fmtDate, fmtDateTime, invoiceNo, jobNo, money, timeAgo, today } from "@/lib/format";
import { getInvoiceDetail } from "@/lib/money/queries";
import { balanceOf, isInvoiceOverdue, PAYMENT_METHOD_LABELS, TERMS_LABELS } from "@/lib/money/service";
import { PrintButton, RecordPaymentButton, SendReminderButton, VoidButton } from "../../_components/client";
import { Num } from "../../_components/parts";
import { invoicePayUrl, MIN_CARD_CENTS, qrDataUrl } from "@/lib/payments/links";
import { PayOnlineActions } from "../../../counter/_components/pay-online";
import { QuickBooksStatus } from "@/components/accounting/quickbooks-status";
import { getQboStatuses } from "@/lib/accounting/quickbooks/server";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  const d = user && /^\d+$/.test(id) ? await getInvoiceDetail(user.tenantId, Number(id)) : null;
  return { title: d ? invoiceNo(d.inv.number) : "Invoice" };
}

export default async function InvoicePage({ params }: Props) {
  const user = await requirePagePermission("money.view");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const d = await getInvoiceDetail(user.tenantId, Number(id));
  if (!d) notFound();
  const qbPayments = await getQboStatuses(user.tenantId, "payment", d.payments.map(({ p }) => p.id));
  const { inv, customer, job } = d;
  const [{ company }, brand] = await Promise.all([getSettings(user.tenantId), getBrand(user.tenantId)]);
  const now = today();
  const balance = balanceOf(inv);
  const overdue = isInvoiceOverdue(inv, now);
  const isVoid = inv.status === "void";
  const activePayments = d.payments.filter((x) => !x.p.voidedAt);
  const canEdit = can(user.role, "money.edit");
  const canVoid = can(user.role, "money.void");
  const canCounter = can(user.role, "counter.use");
  // "Pay online" (Stripe): a link the customer can open any time; null when Stripe isn't connected.
  const payUrl = !isVoid && balance >= MIN_CARD_CENTS && (canEdit || canCounter) ? await invoicePayUrl(user.tenantId, inv.id) : null;
  const payQr = payUrl ? await qrDataUrl(payUrl) : null;
  const billTo = customer.billingAddress ?? [customer.address, [customer.city, customer.state].filter(Boolean).join(", ") + (customer.zip ? ` ${customer.zip}` : "")].filter((s) => s && s.trim()).join("\n");

  return (
    <div>
      {/* Hide the app chrome when printing: only the invoice sheet prints. */}
      <style>{`@media print { @page { margin: 0.6in; } body { background: #fff !important; } aside, header, nav, [data-sonner-toaster] { display: none !important; } main { padding: 0 !important; max-width: none !important; } .min-h-dvh { padding-left: 0 !important; } }`}</style>

      <div className="print:hidden">
        <PageHeader
          back={{ href: "/money?tab=invoices", label: "Invoices" }}
          title={
            <span className="flex flex-wrap items-center gap-3">
              {invoiceNo(inv.number)}
              <InvoiceStatusBadge status={inv.status} overdue={overdue} />
              <QuickBooksStatus tenantId={user.tenantId} entityType="invoice" entityId={inv.id} />
            </span>
          }
          subtitle={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link href={`/customers/${customer.id}`} className="font-medium text-slate-700 hover:underline">
                {customer.name}
              </Link>
              {job && (
                <Link href={`/jobs/${job.number}?tab=money`} className="hover:underline">
                  {jobNo(job.number)} · {job.title}
                </Link>
              )}
              {inv.poNumber && <span>PO {inv.poNumber}</span>}
            </span>
          }
          actions={
            <>
              {canCounter && !isVoid && balance > 0 && (
                <LinkButton href={`/counter/sale/${inv.id}`} variant="success">
                  <Store className="size-4" />
                  Take payment
                </LinkButton>
              )}
              {canEdit && !isVoid && balance > 0 && <RecordPaymentButton invoiceId={inv.id} balanceCents={balance} today={now} />}
              {canEdit && !isVoid && balance > 0 && (
                <SendReminderButton invoiceId={inv.id} invoiceNumber={inv.number} customerName={customer.name} balanceCents={balance} hasEmail={d.hasEmail} size="md" />
              )}
              <PrintButton />
              {canVoid && !isVoid && (
                <VoidButton
                  kind="invoice"
                  id={inv.id}
                  size="md"
                  label="Void"
                  title={`Void ${invoiceNo(inv.number)}?`}
                  description="The invoice stays on record marked Void and no longer counts as owed. This can't be undone — you'd create a new invoice instead."
                  disabled={inv.paidCents > 0}
                  disabledReason="This invoice has payments. Void the payments first."
                />
              )}
            </>
          }
        />

        {isVoid && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-slate-700">
            <Ban className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-medium">This invoice was voided{inv.voidedAt ? ` on ${fmtDateTime(inv.voidedAt)}` : ""}.</p>
              {inv.voidReason && <p className="text-sm">Reason: {inv.voidReason}</p>}
            </div>
          </div>
        )}
        {canVoid && !isVoid && inv.paidCents > 0 && (
          <p className="-mt-3 mb-4 text-right text-xs text-slate-500">To void this invoice, void its payments first.</p>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader title="Line items" />
              {d.items.length === 0 ? (
                <EmptyState compact title="No line items on this invoice." />
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <Th>Description</Th>
                      <Th className="text-right">Qty</Th>
                      <Th className="text-right">Amount</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {d.items.map((it) => (
                      <Tr key={it.id}>
                        <Td>
                          {it.description}
                          {!it.taxable && <span className="ml-2 text-xs text-slate-500">(not taxed)</span>}
                        </Td>
                        <Td className="text-right tabular">{it.quantity.toLocaleString()}</Td>
                        <Td className="text-right">
                          <Num>{money(it.amountCents)}</Num>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
              <div className="border-t border-slate-200 px-4 py-4">
                <Totals inv={inv} balance={balance} />
              </div>
            </Card>

            <Card>
              <CardHeader title="Payments" description={activePayments.length ? undefined : d.payments.length ? "No active payments (voided payments shown below)." : "No payments yet."} />
              {d.payments.length > 0 && (
                <Table>
                  <THead>
                    <tr>
                      <Th>Received</Th>
                      <Th>Method</Th>
                      <Th>Reference</Th>
                      <Th className="text-right">Amount</Th>
                      <Th>Recorded by</Th>
                      {canVoid && <Th />}
                    </tr>
                  </THead>
                  <tbody>
                    {d.payments.map(({ p, recordedByName }) => (
                      <Tr key={p.id} className={p.voidedAt ? "text-slate-400" : undefined}>
                        <Td className="whitespace-nowrap">{fmtDate(p.receivedOn, { year: true })}</Td>
                        <Td>
                          {PAYMENT_METHOD_LABELS[p.method]}
                          {!p.voidedAt && (
                            <span className="mt-1 block">
                              <QuickBooksStatus tenantId={user.tenantId} entityType="payment" entityId={p.id} status={qbPayments.get(p.id) ?? null} />
                            </span>
                          )}
                        </Td>
                        <Td>
                          {p.reference ?? "—"}
                          {p.notes && <span className="block whitespace-pre-line text-xs text-slate-500">{p.notes}</span>}
                        </Td>
                        <Td className="text-right">
                          <Num className={p.voidedAt ? "line-through" : "font-medium"}>{money(p.amountCents)}</Num>
                        </Td>
                        <Td className="whitespace-nowrap">{recordedByName ?? (p.processorRef ? "Paid online" : "—")}</Td>
                        {canVoid && (
                          <Td className="text-right">
                            {p.voidedAt ? (
                              <Badge>Void</Badge>
                            ) : (
                              <VoidButton kind="payment" id={p.id} title="Void this payment?" description={`${money(p.amountCents)} received ${fmtDate(p.receivedOn)}. The balance goes back up by this amount.`} />
                            )}
                          </Td>
                        )}
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardBody className="space-y-3">
                <div>
                  <p className="text-sm text-slate-500">Balance due</p>
                  <p className={`text-3xl font-semibold tabular ${balance > 0 ? (overdue ? "text-red-700" : "text-slate-900") : "text-emerald-700"}`}>{money(balance)}</p>
                  {!isVoid && balance > 0 && <p className={`text-sm ${overdue ? "font-medium text-red-700" : "text-slate-500"}`}>{overdue ? dueLabel(inv.dueDate, now) : `Due ${dueLabel(inv.dueDate, now)}`}</p>}
                  {inv.status === "paid" && <p className="text-sm text-emerald-700">Paid in full</p>}
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-sm">
                  <dt className="text-slate-500">Issued</dt>
                  <dd className="text-right">{fmtDate(inv.issueDate, { year: true })}</dd>
                  <dt className="text-slate-500">Due</dt>
                  <dd className="text-right">{fmtDate(inv.dueDate, { year: true })}</dd>
                  <dt className="text-slate-500">Terms</dt>
                  <dd className="text-right">{TERMS_LABELS[customer.paymentTerms]}</dd>
                  {inv.poNumber && (
                    <>
                      <dt className="text-slate-500">PO</dt>
                      <dd className="text-right">{inv.poNumber}</dd>
                    </>
                  )}
                  <dt className="text-slate-500">Created by</dt>
                  <dd className="text-right">{d.createdByName ?? "—"}</dd>
                  <dt className="text-slate-500">Last reminder</dt>
                  <dd className="text-right">{inv.lastReminderAt ? timeAgo(inv.lastReminderAt) : "Never"}</dd>
                </dl>
                {inv.notes && <p className="whitespace-pre-line border-t border-slate-100 pt-3 text-sm text-slate-600">{inv.notes}</p>}
              </CardBody>
            </Card>

            {payUrl && payQr && (
              <Card>
                <CardHeader title={<span className="flex items-center gap-2"><CreditCard className="size-4 text-slate-500" /> Pay online</span>} description={`The customer can pay the ${money(balance)} balance by card (Stripe). Payment reminders include this link.`} />
                <CardBody>
                  <PayOnlineActions invoiceId={inv.id} url={payUrl} qr={payQr} defaultEmail={customer.email} />
                </CardBody>
              </Card>
            )}

            {d.reminders.length > 0 && (
              <Card>
                <CardHeader title="Reminders sent" />
                <ul className="divide-y divide-slate-100">
                  {d.reminders.map((r) => (
                    <li key={r.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                      <Mail className="mt-0.5 size-4 text-slate-400" />
                      <div>
                        <p className="text-slate-800">
                          {fmtDateTime(r.createdAt)} to {r.toAddress}
                          {r.status === "failed" && <span className="ml-2 font-medium text-red-700">(failed)</span>}
                        </p>
                        {r.sentByName && <p className="text-slate-500">by {r.sentByName}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card>
              <CardHeader title="History" />
              {d.activity.length === 0 ? (
                <EmptyState compact icon={History} title="No history yet." />
              ) : (
                <ul className="space-y-3 px-5 py-4">
                  {d.activity.map((a) => (
                    <li key={a.id} className="text-sm">
                      <p className="text-slate-800">{a.summary}</p>
                      <p className="text-xs text-slate-500">
                        {a.actorName ?? "System"} · {fmtDateTime(a.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </div>

      {/* ---------- Print sheet ---------- */}
      <div className="hidden bg-white text-[13px] leading-snug text-black print:block">
        <div className="flex items-start justify-between border-b-2 border-black pb-4">
          <div>
            {brand.logoUrl ? (
              <Logo brand={brand} className="max-h-16" />
            ) : (
              <>
                <p className="text-2xl font-bold tracking-tight">{company.name.toUpperCase()}</p>
                <p className="text-xs font-semibold tracking-[0.2em]">{company.tagline.toUpperCase()}</p>
              </>
            )}
            <p className="mt-2">{company.address}</p>
            <p>
              {company.phone} · {company.email}
            </p>
            {company.website && <p>{company.website.replace(/^https?:\/\//, "")}</p>}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">INVOICE</p>
            <p className="text-base font-semibold">{invoiceNo(inv.number)}</p>
            {isVoid && <p className="mt-1 text-lg font-bold">VOID</p>}
            <table className="ml-auto mt-2 text-right">
              <tbody>
                <tr>
                  <td className="pr-3 text-gray-600">Date</td>
                  <td>{fmtDate(inv.issueDate, { year: true, weekday: false })}</td>
                </tr>
                <tr>
                  <td className="pr-3 text-gray-600">Due</td>
                  <td>{fmtDate(inv.dueDate, { year: true, weekday: false })}</td>
                </tr>
                <tr>
                  <td className="pr-3 text-gray-600">Terms</td>
                  <td>{TERMS_LABELS[customer.paymentTerms]}</td>
                </tr>
                {inv.poNumber && (
                  <tr>
                    <td className="pr-3 text-gray-600">PO #</td>
                    <td>{inv.poNumber}</td>
                  </tr>
                )}
                {job && (
                  <tr>
                    <td className="pr-3 text-gray-600">Job</td>
                    <td>{jobNo(job.number)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Bill to</p>
          <p className="font-semibold">{customer.name}</p>
          {billTo && <p className="whitespace-pre-line">{billTo}</p>}
          {customer.email && <p>{customer.email}</p>}
        </div>

        {job && <p className="mt-4">Re: {job.title}</p>}

        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1.5 font-semibold">Description</th>
              <th className="py-1.5 text-right font-semibold">Qty</th>
              <th className="py-1.5 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.items.map((it) => (
              <tr key={it.id} className="border-b border-gray-300 align-top">
                <td className="py-1.5 pr-4">{it.description}</td>
                <td className="py-1.5 text-right">{it.quantity.toLocaleString()}</td>
                <td className="py-1.5 text-right tabular">{money(it.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto mt-3 w-72">
          <Totals inv={inv} balance={balance} print />
        </div>

        <div className="mt-10 border-t border-gray-300 pt-3 text-center text-xs text-gray-700">
          <p>Thank you for your business! Please include {invoiceNo(inv.number)} with your payment.</p>
          <p className="mt-1">
            {company.name} · {company.tagline} · {company.phone}
          </p>
        </div>
      </div>
    </div>
  );
}

function Totals({ inv, balance, print }: { inv: { subtotalCents: number; taxCents: number; taxRate: number; totalCents: number; paidCents: number; status: string }; balance: number; print?: boolean }) {
  const row = "flex justify-between gap-6 py-0.5";
  const muted = print ? "text-gray-700" : "text-slate-500";
  return (
    <div className={`ml-auto max-w-xs text-[15px] ${print ? "max-w-none text-[13px]" : ""}`}>
      <div className={row}>
        <span className={muted}>Subtotal</span>
        <Num>{money(inv.subtotalCents)}</Num>
      </div>
      <div className={row}>
        <span className={muted}>Sales tax{inv.taxRate ? ` (${(inv.taxRate * 100).toFixed(2).replace(/\.?0+$/, "")}%)` : ""}</span>
        <Num>{money(inv.taxCents)}</Num>
      </div>
      <div className={`${row} border-t ${print ? "border-black" : "border-slate-200"} mt-1 pt-1.5 font-semibold`}>
        <span>Total</span>
        <Num>{money(inv.totalCents)}</Num>
      </div>
      {inv.paidCents > 0 && (
        <div className={row}>
          <span className={muted}>Paid</span>
          <Num>−{money(inv.paidCents)}</Num>
        </div>
      )}
      <div className={`${row} font-semibold ${print ? "text-base" : "text-lg"}`}>
        <span>Balance due</span>
        <Num>{money(balance)}</Num>
      </div>
    </div>
  );
}
