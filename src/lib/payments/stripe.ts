/**
 * Stripe REST client (no SDK) and webhook signature checks.
 *
 * Pure and dependency-free (node:crypto only) so it can be unit-tested: pass a fake `fetch`.
 * Each shop connects its OWN Stripe account (Settings → Integrations); its secret key and
 * webhook signing secret are stored sealed in tenant_integrations (see ./connection.ts).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const STRIPE_API = "https://api.stripe.com";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** A Stripe call that failed. `network` = Stripe couldn't be reached at all. */
export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null = null,
    readonly network = false,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------
/** sk_live_… / sk_test_… (secret) or rk_live_… / rk_test_… (restricted). */
export const isStripeSecretKey = (s: string) => /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(s);
export const isWebhookSecret = (s: string) => /^whsec_[A-Za-z0-9+/=]{10,}$/.test(s);
export const isLiveKey = (s: string) => /^(sk|rk)_live_/.test(s);
/** "sk_live_…a1B2" — enough to recognize a key without revealing it. */
export const keyHint = (s: string) => `${s.slice(0, s.indexOf("_", 3) + 1)}…${s.slice(-4)}`;

// ---------------------------------------------------------------------------
// Form encoding (Stripe takes application/x-www-form-urlencoded with bracket nesting)
// ---------------------------------------------------------------------------
export type FormValue = string | number | boolean | null | undefined | FormValue[] | { [k: string]: FormValue };

/** { a: { b: 1 }, list: [{ x: "y" }] } → "a[b]=1&list[0][x]=y". null/undefined are left out. */
export function formEncode(obj: Record<string, FormValue>): string {
  const pairs: [string, string][] = [];
  const walk = (key: string, v: FormValue) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${key}[${i}]`, x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v)) walk(`${key}[${k}]`, x);
    else pairs.push([key, String(v)]);
  };
  for (const [k, v] of Object.entries(obj)) walk(k, v);
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

// ---------------------------------------------------------------------------
// Checkout Sessions
// ---------------------------------------------------------------------------
export type CheckoutSession = {
  id: string;
  object: "checkout.session";
  url: string | null;
  status: "open" | "complete" | "expired" | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  amount_total: number | null;
  currency: string | null;
  payment_intent: string | { id: string } | null;
  customer_email?: string | null;
  customer_details?: { email?: string | null; name?: string | null } | null;
  metadata: Record<string, string> | null;
  livemode?: boolean;
  expires_at?: number;
};

export type CheckoutRequest = {
  invoiceNumberLabel: string; // "INV-7001"
  shopName: string;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
  metadata: { tenantId: number; invoiceId: number; paymentLinkId: number };
  customerEmail?: string | null;
};

/** The body for POST /v1/checkout/sessions: one line for the amount being paid on the invoice. */
export function checkoutSessionParams(r: CheckoutRequest): Record<string, FormValue> {
  if (!Number.isInteger(r.amountCents) || r.amountCents < 50) throw new Error("Card payments must be at least $0.50.");
  const name = `Invoice ${r.invoiceNumberLabel} — ${r.shopName}`.slice(0, 250);
  return {
    mode: "payment",
    success_url: r.successUrl,
    cancel_url: r.cancelUrl,
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: r.amountCents, product_data: { name } } }],
    metadata: { tenantId: String(r.metadata.tenantId), invoiceId: String(r.metadata.invoiceId), paymentLinkId: String(r.metadata.paymentLinkId) },
    payment_intent_data: {
      description: name,
      metadata: { tenantId: String(r.metadata.tenantId), invoiceId: String(r.metadata.invoiceId), paymentLinkId: String(r.metadata.paymentLinkId) },
    },
    customer_email: r.customerEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.customerEmail) ? r.customerEmail : undefined,
  };
}

/** What to do with a Checkout Session we hear about (webhook, polling or the thank-you page). */
export type SessionDecision =
  | { action: "record"; amountCents: number }
  | { action: "already_recorded" }
  | { action: "ignore"; reason: string };

export function decideSession(
  session: Pick<CheckoutSession, "id" | "payment_status" | "amount_total" | "currency">,
  link: { status: "open" | "paid" | "expired"; paymentId: number | null; providerRef: string } | null,
): SessionDecision {
  if (!link) return { action: "ignore", reason: "No payment link for this session." };
  if (link.providerRef !== session.id) return { action: "ignore", reason: "Session doesn't match the payment link." };
  if (link.status === "paid" || link.paymentId) return { action: "already_recorded" };
  if (session.payment_status !== "paid") return { action: "ignore", reason: `Not paid yet (${session.payment_status}).` };
  if (session.currency && session.currency.toLowerCase() !== "usd") return { action: "ignore", reason: `Unexpected currency ${session.currency}.` };
  const amount = session.amount_total ?? 0;
  if (!(amount > 0)) return { action: "ignore", reason: "No amount on the session." };
  return { action: "record", amountCents: amount };
}

export type StripeAccount = { id: string; business_profile?: { name?: string | null } | null; settings?: { dashboard?: { display_name?: string | null } } | null; email?: string | null };

export function accountName(a: StripeAccount) {
  return a.settings?.dashboard?.display_name || a.business_profile?.name || a.email || a.id;
}

/** A tiny Stripe client bound to one shop's secret key. */
export function stripeClient(secretKey: string, fetchImpl: FetchLike = fetch) {
  async function call<T>(method: "GET" | "POST", path: string, body?: Record<string, FormValue>, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${secretKey}`, "Stripe-Version": "2024-06-20" };
    if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    let res: Response;
    try {
      res = await fetchImpl(`${STRIPE_API}${path}`, { method, headers, body: body ? formEncode(body) : undefined, signal: AbortSignal.timeout(15000) });
    } catch (e) {
      throw new StripeError(`Couldn't reach Stripe (${e instanceof Error ? e.message : "network error"}).`, null, null, true);
    }
    const json = (await res.json().catch(() => null)) as (T & { error?: { message?: string; code?: string } }) | null;
    // No JSON at all means we never talked to Stripe itself (a proxy, firewall or outage page).
    if (!json) throw new StripeError(`Couldn't reach Stripe (HTTP ${res.status}).`, res.status, null, true);
    if (!res.ok) throw new StripeError(json.error?.message ?? `Stripe returned ${res.status}.`, res.status, json.error?.code ?? null);
    return json;
  }
  return {
    getAccount: () => call<StripeAccount>("GET", "/v1/account"),
    /** Cheap check that the key may use Checkout (works for restricted keys too). */
    listCheckoutSessions: () => call<{ data: CheckoutSession[] }>("GET", "/v1/checkout/sessions?limit=1"),
    createCheckoutSession: (req: CheckoutRequest, idempotencyKey?: string) => call<CheckoutSession>("POST", "/v1/checkout/sessions", checkoutSessionParams(req), idempotencyKey),
    getCheckoutSession: (id: string) => {
      if (!/^cs_[A-Za-z0-9_]+$/.test(id)) throw new StripeError("Not a Checkout Session id.", 400);
      return call<CheckoutSession>("GET", `/v1/checkout/sessions/${id}`);
    },
  };
}
export type StripeClient = ReturnType<typeof stripeClient>;

// ---------------------------------------------------------------------------
// Webhook signatures
// ---------------------------------------------------------------------------
/** Stripe-Signature for a payload (what Stripe sends). Used by tests and local webhook tries. */
export function signStripePayload(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

export type SignatureCheck = { ok: true; timestamp: number } | { ok: false; reason: string };

/**
 * Verify a Stripe-Signature header: "t=<unix>,v1=<hex>[,v1=…][,v0=…]".
 * HMAC-SHA256 of `${t}.${rawBody}` with the endpoint's signing secret (the whole "whsec_…" string),
 * compared in constant time, and `t` must be within `toleranceSec` of now (replay protection).
 */
export function verifyStripeSignature(rawBody: string, header: string | null | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): SignatureCheck {
  if (!header) return { ok: false, reason: "Missing Stripe-Signature header." };
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t" && /^\d+$/.test(v)) t = Number(v);
    else if (k === "v1" && /^[0-9a-f]+$/i.test(v)) v1.push(v.toLowerCase());
  }
  if (t === null || !v1.length) return { ok: false, reason: "Malformed Stripe-Signature header." };
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex"), "utf8");
  const match = v1.some((s) => {
    const got = Buffer.from(s, "utf8");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!match) return { ok: false, reason: "Signature doesn't match." };
  if (Math.abs(nowSec - t) > toleranceSec) return { ok: false, reason: "Signature timestamp is too old." };
  return { ok: true, timestamp: t };
}
