import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { CheckCircle2, CircleSlash, Clock, Loader2 } from "lucide-react";
import { db } from "@/lib/db";
import { invoices, paymentLinks } from "@/lib/db/schema";
import { getBrand } from "@/lib/brand";
import { getSettings } from "@/lib/settings";
import { getTenantBySlug } from "@/lib/tenant";
import { invoiceNo, money } from "@/lib/format";
import { getStripeKeys } from "@/lib/payments/connection";
import { recordStripeSession } from "@/lib/payments/links";
import { stripeClient } from "@/lib/payments/stripe";
import { PayCard, PayShell } from "../_components/pay-shell";

export const metadata: Metadata = { title: "Payment", robots: { index: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ shop?: string; session_id?: string; cancelled?: string; expired?: string; invalid?: string }> };

/** Where Stripe sends the customer after paying (public). Also records the payment if the webhook hasn't yet. */
export default async function PayDonePage({ searchParams }: Props) {
  const sp = await searchParams;
  const slug = sp.shop && /^[a-z0-9-]{1,60}$/i.test(sp.shop) ? sp.shop : null;
  const tenant = slug ? await getTenantBySlug(slug).catch(() => undefined) : undefined;
  const [brand, settings] = tenant ? await Promise.all([getBrand(tenant.id), getSettings(tenant.id)]) : [null, null];
  const company = settings?.company ?? null;
  const shop = company?.name || "the shop";
  const contact = company && (company.phone || company.email) ? ` at ${[company.phone, company.email].filter(Boolean).join(" or ")}` : "";

  if (sp.cancelled)
    return (
      <PayShell brand={brand} company={company}>
        <PayCard icon={<CircleSlash className="size-12 text-slate-400" />} title="Payment cancelled">
          <p>No charge was made. You can pay another way or scan the code again.</p>
        </PayCard>
      </PayShell>
    );
  if (sp.expired || sp.invalid || !tenant || !sp.session_id)
    return (
      <PayShell brand={brand} company={company}>
        <PayCard icon={<Clock className="size-12 text-slate-400" />} title={sp.expired ? "This payment link has expired" : "This payment link isn't valid"}>
          <p>Please contact {shop}{contact} for a new link.</p>
        </PayCard>
      </PayShell>
    );

  // Look up what was paid; if the webhook hasn't recorded it yet, ask Stripe now (recorded once either way).
  const sessionId = sp.session_id.slice(0, 255);
  const [row] = await db
    .select({ link: paymentLinks, number: invoices.number })
    .from(paymentLinks)
    .innerJoin(invoices, eq(invoices.id, paymentLinks.invoiceId))
    .where(and(eq(paymentLinks.tenantId, tenant.id), eq(paymentLinks.providerRef, sessionId)));
  let paid = row?.link.status === "paid";
  if (row && !paid && row.link.status === "open") {
    const keys = await getStripeKeys(tenant.id);
    if (keys) {
      try {
        const session = await stripeClient(keys.secretKey).getCheckoutSession(sessionId);
        if (session.payment_status === "paid") paid = (await recordStripeSession(tenant.id, session, "return")).result !== "ignored";
      } catch (e) {
        console.error("[pay/done] couldn't check the session", e);
      }
    }
  }
  if (!row)
    return (
      <PayShell brand={brand} company={company}>
        <PayCard icon={<Clock className="size-12 text-slate-400" />} title="We couldn't find this payment">
          <p>If you were charged, don&apos;t worry — {shop} will see it. Questions? Contact them{contact}.</p>
        </PayCard>
      </PayShell>
    );
  return (
    <PayShell brand={brand} company={company}>
      {paid ? (
        <PayCard icon={<CheckCircle2 className="size-14 text-emerald-600" />} title={`Thanks! Your payment to ${shop} was received.`}>
          <p className="text-lg font-medium text-slate-900">
            {money(row.link.amountCents)} · Invoice {invoiceNo(row.number)}
          </p>
          <p>Thank you! You can close this page.</p>
        </PayCard>
      ) : (
        <PayCard icon={<Loader2 className="size-12 animate-spin text-slate-400" />} title="Thanks! Your payment is being confirmed.">
          <p>
            {money(row.link.amountCents)} · Invoice {invoiceNo(row.number)}
          </p>
          <p>This usually takes a moment. {shop} will see it as soon as Stripe confirms it.</p>
        </PayCard>
      )}
    </PayShell>
  );
}
