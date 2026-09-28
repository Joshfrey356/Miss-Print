import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { CheckCircle2, Clock, Lock } from "lucide-react";
import { db } from "@/lib/db";
import { customers, invoices } from "@/lib/db/schema";
import { getBrand } from "@/lib/brand";
import { getSettings } from "@/lib/settings";
import { fmtDate, invoiceNo, money } from "@/lib/format";
import { balanceOf } from "@/lib/money/service";
import { stripeConnected } from "@/lib/payments/connection";
import { MIN_CARD_CENTS } from "@/lib/payments/links";
import { readPayToken } from "@/lib/payments/tokens";
import { PayCard, PayShell } from "../../_components/pay-shell";
import { PayButton } from "./pay-button";

export const metadata: Metadata = { title: "Pay invoice", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Public "Pay online" page from a payment reminder / pay-link email. Access by the sealed token only. */
export default async function PayInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = readPayToken(token, "invoice");
  const [row] = t
    ? await db
        .select({ inv: invoices, customerName: customers.name })
        .from(invoices)
        .innerJoin(customers, eq(customers.id, invoices.customerId))
        .where(and(eq(invoices.tenantId, t.tenantId), eq(invoices.id, t.id)))
    : [];
  const [brand, settings, connected] = t ? await Promise.all([getBrand(t.tenantId), getSettings(t.tenantId), stripeConnected(t.tenantId)]) : [null, null, false];
  const company = settings?.company ?? null;
  const shop = company?.name || "the shop";
  const contact = company && (company.phone || company.email) ? ` at ${[company.phone, company.email].filter(Boolean).join(" or ")}` : "";

  if (!row)
    return (
      <PayShell brand={brand} company={company}>
        <PayCard icon={<Clock className="size-12 text-slate-400" />} title="This payment link isn't valid">
          <p>Please contact {shop}{contact}.</p>
        </PayCard>
      </PayShell>
    );
  const balance = balanceOf(row.inv);
  const number = invoiceNo(row.inv.number);
  return (
    <PayShell brand={brand} company={company}>
      {row.inv.status === "void" ? (
        <PayCard icon={<Clock className="size-12 text-slate-400" />} title={`Invoice ${number} was cancelled`}>
          <p>Nothing is owed on it. Questions? Contact {shop}{contact}.</p>
        </PayCard>
      ) : balance <= 0 ? (
        <PayCard icon={<CheckCircle2 className="size-14 text-emerald-600" />} title={`Invoice ${number} is paid in full`}>
          <p>Thank you! There's nothing more to pay.</p>
        </PayCard>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
            {row.customerName} · Invoice {number}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Pay {shop}</h1>
          <dl className="mt-5 space-y-2 text-[15px]">
            <div className="flex justify-between">
              <dt className="text-slate-500">Invoice total</dt>
              <dd className="tabular">{money(row.inv.totalCents)}</dd>
            </div>
            {row.inv.paidCents > 0 && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Already paid</dt>
                <dd className="tabular">−{money(row.inv.paidCents)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-slate-500">Due</dt>
              <dd>{fmtDate(row.inv.dueDate, { year: true })}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-3 text-lg font-semibold text-slate-900">
              <dt>Balance</dt>
              <dd className="tabular">{money(balance)}</dd>
            </div>
          </dl>
          {connected && balance >= MIN_CARD_CENTS ? (
            <>
              <PayButton token={token} label={`Pay ${money(balance)} by card`} />
              <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-slate-500">
                <Lock className="size-3.5" /> Secure payment page run by Stripe
              </p>
            </>
          ) : (
            <p className="mt-6 rounded-lg bg-slate-50 px-4 py-3 text-[15px] text-slate-700">
              Online card payments aren&apos;t available for this invoice right now. Please contact {shop}{contact} to pay.
            </p>
          )}
        </div>
      )}
    </PayShell>
  );
}
