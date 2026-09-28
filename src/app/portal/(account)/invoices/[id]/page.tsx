import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Phone } from "lucide-react";
import { requirePortal } from "@/lib/portal/session";
import { getPortalSettings } from "@/lib/portal/settings";
import { portalInvoice } from "@/lib/portal/queries";
import { getBrand } from "@/lib/brand";
import { getSettings } from "@/lib/settings";
import { stripeConnected } from "@/lib/payments/connection";
import { MIN_CARD_CENTS } from "@/lib/payments/links";
import { PAYMENT_METHOD_LABELS } from "@/lib/money/labels";
import { fmtDate, invoiceNo, jobNo, money, today } from "@/lib/format";
import { Logo } from "@/components/logo";
import { PrintButton } from "@/components/print-button";
import { InvoiceStatusPill } from "@/components/portal/parts";
import { PortalPayButton } from "@/components/portal/pay-button";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Invoice ${(await params).id}` };
}

/** The customer's copy of an invoice: pay online (Stripe) or call, and print. */
export default async function PortalInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePortal();
  const raw = (await params).id;
  if (!/^\d{1,9}$/.test(raw)) notFound();
  const d = await portalInvoice(s, Number(raw));
  if (!d) notFound();
  const [brand, { company }, stripe, portal] = await Promise.all([getBrand(s.tenantId), getSettings(s.tenantId), stripeConnected(s.tenantId), getPortalSettings(s.tenantId)]);
  const canCard = stripe && portal.features.pay;
  const { inv } = d;
  const now = today();
  const due = inv.balanceCents > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <style>{`@media print { @page { margin: 0.6in; } }`}</style>
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/portal/invoices" className="text-sm text-slate-500 hover:text-slate-800">
          ← Invoices
        </Link>
        <PrintButton />
      </div>

      {due && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 print:hidden">
          <p className="text-[15px] text-slate-600">
            Balance due{inv.dueDate < now ? " (was due " : " by "}
            {fmtDate(inv.dueDate, { year: true })}
            {inv.dueDate < now ? ")" : ""}
          </p>
          <p className="tabular mt-0.5 text-3xl font-semibold text-slate-900">{money(inv.balanceCents)}</p>
          <div className="mt-4">
            {canCard && inv.balanceCents >= MIN_CARD_CENTS ? (
              <>
                <PortalPayButton invoiceId={inv.id} label={`Pay ${money(inv.balanceCents)} online`} />
                <p className="mt-2 text-sm text-slate-500">Secure card payment by Stripe. You&apos;ll get a receipt by email.</p>
              </>
            ) : (
              <p className="flex items-center gap-2 text-[15px] text-slate-700">
                <Phone className="size-4 text-slate-400" />
                {company.phone ? (
                  <>
                    Call us to pay:{" "}
                    <a href={`tel:${company.phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-brand-700 hover:underline">
                      {company.phone}
                    </a>
                  </>
                ) : (
                  "Please contact us to pay."
                )}
              </p>
            )}
          </div>
        </div>
      )}
      {!due && (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[15px] text-emerald-900 print:hidden">
          <CheckCircle2 className="size-5" /> Paid in full. Thank you!
        </div>
      )}

      {/* The invoice itself (also what prints). */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8 print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <div className="flex flex-col gap-4 border-b-2 border-slate-900 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Logo brand={brand} />
            <div className="mt-2 text-sm text-slate-600">
              {company.address && <p className="whitespace-pre-line">{company.address}</p>}
              <p>{[company.phone, company.email, company.website].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-2xl font-black tracking-tight">INVOICE</p>
            <p className="text-lg font-semibold">{invoiceNo(inv.number)}</p>
            <div className="mt-1 print:hidden">
              <InvoiceStatusPill status={inv.status} balanceCents={inv.balanceCents} overdue={inv.dueDate < now} />
            </div>
            <dl className="mt-2 grid grid-cols-[auto_auto] justify-start gap-x-3 text-sm text-slate-600 sm:justify-end">
              <dt>Date</dt>
              <dd>{fmtDate(inv.issueDate, { year: true, weekday: false })}</dd>
              <dt>Due</dt>
              <dd>{fmtDate(inv.dueDate, { year: true, weekday: false })}</dd>
              {inv.poNumber && (
                <>
                  <dt>PO #</dt>
                  <dd>{inv.poNumber}</dd>
                </>
              )}
              {inv.jobNumber && (
                <>
                  <dt>Order</dt>
                  <dd>{jobNo(inv.jobNumber, brand.jobPrefix)}</dd>
                </>
              )}
            </dl>
          </div>
        </div>
        <div className="mt-4 text-[15px]">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bill to</p>
          <p className="font-semibold">{s.customerName}</p>
          {inv.jobTitle && <p className="mt-2 text-slate-600">Re: {inv.jobTitle}</p>}
        </div>
        <table className="mt-5 w-full border-collapse text-[15px]">
          <thead>
            <tr className="border-b-2 border-slate-900 text-left">
              <th className="py-1.5 pr-3 font-semibold">Description</th>
              <th className="py-1.5 pr-3 text-right font-semibold">Qty</th>
              <th className="py-1.5 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.items.map((it) => (
              <tr key={it.id} className="border-b border-slate-200 align-top">
                <td className="py-2 pr-3">{it.description}</td>
                <td className="tabular py-2 pr-3 text-right">{it.quantity.toLocaleString()}</td>
                <td className="tabular py-2 text-right">{money(it.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="tabular ml-auto mt-4 grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-right text-[15px]">
          <dt className="text-slate-500">Subtotal</dt>
          <dd>{money(inv.subtotalCents)}</dd>
          <dt className="text-slate-500">Sales tax{inv.taxRate ? ` (${(inv.taxRate * 100).toFixed(2).replace(/\.?0+$/, "")}%)` : ""}</dt>
          <dd>{money(inv.taxCents)}</dd>
          <dt className="font-semibold">Total</dt>
          <dd className="font-semibold">{money(inv.totalCents)}</dd>
          {d.payments.map((p) => (
            <div key={p.id} className="contents text-slate-600">
              <dt>
                Paid {fmtDate(p.receivedOn, { weekday: false })} ({PAYMENT_METHOD_LABELS[p.method]})
              </dt>
              <dd>−{money(p.amountCents)}</dd>
            </div>
          ))}
          <dt className="text-lg font-semibold">Balance due</dt>
          <dd className="text-lg font-semibold">{money(inv.balanceCents)}</dd>
        </dl>
        <p className="mt-8 border-t border-slate-200 pt-3 text-center text-sm text-slate-500">
          Thank you for your business! Please include {invoiceNo(inv.number)} with your payment.
        </p>
      </div>
    </div>
  );
}
