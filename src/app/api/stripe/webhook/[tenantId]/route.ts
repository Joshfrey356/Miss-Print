import { NextResponse } from "next/server";
import { getStripeKeys } from "@/lib/payments/connection";
import { recordStripeSession } from "@/lib/payments/links";
import { verifyStripeSignature, type CheckoutSession } from "@/lib/payments/stripe";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook for one shop: https://<app>/api/stripe/webhook/<tenantId>
 * (shown in Settings → Integrations). Public — Stripe signs every call with the shop's
 * webhook signing secret, which we check before trusting anything in the body.
 */
export async function POST(req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId: raw } = await params;
  if (!/^\d{1,9}$/.test(raw)) return NextResponse.json({ error: "Unknown shop" }, { status: 404 });
  const tenantId = Number(raw);
  const body = await req.text(); // the raw body: the signature is over these exact bytes
  const keys = await getStripeKeys(tenantId);
  // Not connected (or disconnected): nothing to verify against. 400 so Stripe shows the failure.
  if (!keys) return NextResponse.json({ error: "Stripe isn't connected for this shop" }, { status: 400 });
  const check = verifyStripeSignature(body, req.headers.get("stripe-signature"), keys.webhookSecret);
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });

  let event: { id?: string; type?: string; data?: { object?: CheckoutSession } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const type = event.type ?? "";
  const session = event.data?.object;
  if ((type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") && session?.object === "checkout.session") {
    // Metadata is ours, set when the link was made; a session for another shop is simply not found.
    if (session.metadata?.tenantId && session.metadata.tenantId !== String(tenantId)) return NextResponse.json({ received: true, ignored: "other shop" });
    try {
      const r = await recordStripeSession(tenantId, session, "webhook");
      return NextResponse.json({ received: true, result: r.result, reason: r.reason });
    } catch (e) {
      console.error("[stripe webhook]", e);
      return NextResponse.json({ error: "Couldn't record the payment" }, { status: 500 }); // Stripe retries
    }
  }
  return NextResponse.json({ received: true, ignored: type || "unknown event" });
}
