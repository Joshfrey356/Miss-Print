import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkoutSessionParams,
  decideSession,
  formEncode,
  isStripeSecretKey,
  isWebhookSecret,
  keyHint,
  signStripePayload,
  stripeClient,
  verifyStripeSignature,
  type CheckoutSession,
} from "../src/lib/payments/stripe";

const SECRET = "whsec_test_abc123DEF456ghi789";
const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_test_1" } } });

test("webhook signature: a correctly signed payload passes", () => {
  const now = 1_760_000_000;
  const header = signStripePayload(body, SECRET, now);
  assert.match(header, /^t=1760000000,v1=[0-9a-f]{64}$/);
  assert.deepEqual(verifyStripeSignature(body, header, SECRET, now + 10), { ok: true, timestamp: now });
});

test("webhook signature: extra v0/v1 entries and spaces are tolerated", () => {
  const now = 1_760_000_000;
  const good = signStripePayload(body, SECRET, now).split(",")[1]!;
  const header = `t=${now}, v1=${"0".repeat(64)}, ${good}, v0=deadbeef`;
  assert.equal(verifyStripeSignature(body, header, SECRET, now).ok, true);
});

test("webhook signature: tampering, wrong secret, old timestamps and junk fail", () => {
  const now = 1_760_000_000;
  const header = signStripePayload(body, SECRET, now);
  assert.equal(verifyStripeSignature(body + " ", header, SECRET, now).ok, false); // body changed
  assert.equal(verifyStripeSignature(body, header, "whsec_other_secret_value", now).ok, false);
  const old = verifyStripeSignature(body, header, SECRET, now + 301);
  assert.equal(old.ok, false);
  assert.match((old as { reason: string }).reason, /too old/);
  assert.equal(verifyStripeSignature(body, header, SECRET, now - 301).ok, false); // from the future
  assert.equal(verifyStripeSignature(body, null, SECRET, now).ok, false);
  assert.equal(verifyStripeSignature(body, "garbage", SECRET, now).ok, false);
  assert.equal(verifyStripeSignature(body, `t=${now},v1=abc`, SECRET, now).ok, false); // wrong length
  // Re-signing with a different timestamp (replay with a forged t) fails.
  const sig = header.split("v1=")[1];
  assert.equal(verifyStripeSignature(body, `t=${now + 5},v1=${sig}`, SECRET, now + 5).ok, false);
});

test("form encoding uses Stripe's bracket nesting and skips empty values", () => {
  assert.equal(formEncode({ a: 1, b: { c: "x y", d: null }, list: [{ q: 2 }, { q: 3 }], e: undefined, t: true }), "a=1&b%5Bc%5D=x%20y&list%5B0%5D%5Bq%5D=2&list%5B1%5D%5Bq%5D=3&t=true");
});

test("checkout session request: one line for the amount, metadata, return URLs", () => {
  const params = checkoutSessionParams({
    invoiceNumberLabel: "INV-7001",
    shopName: "Miss Print",
    amountCents: 12345,
    successUrl: "https://app.example/pay/done?shop=miss-print&session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: "https://app.example/pay/done?shop=miss-print&cancelled=1",
    metadata: { tenantId: 1, invoiceId: 42, paymentLinkId: 7 },
    customerEmail: "pat@example.com",
  });
  const decoded = new URLSearchParams(formEncode(params));
  assert.equal(decoded.get("mode"), "payment");
  assert.equal(decoded.get("line_items[0][quantity]"), "1");
  assert.equal(decoded.get("line_items[0][price_data][currency]"), "usd");
  assert.equal(decoded.get("line_items[0][price_data][unit_amount]"), "12345");
  assert.equal(decoded.get("line_items[0][price_data][product_data][name]"), "Invoice INV-7001 — Miss Print");
  assert.equal(decoded.get("success_url"), "https://app.example/pay/done?shop=miss-print&session_id={CHECKOUT_SESSION_ID}");
  assert.equal(decoded.get("cancel_url"), "https://app.example/pay/done?shop=miss-print&cancelled=1");
  assert.equal(decoded.get("metadata[tenantId]"), "1");
  assert.equal(decoded.get("metadata[invoiceId]"), "42");
  assert.equal(decoded.get("metadata[paymentLinkId]"), "7");
  assert.equal(decoded.get("customer_email"), "pat@example.com");
  // Bad email is left out rather than failing at Stripe.
  const noEmail = new URLSearchParams(formEncode(checkoutSessionParams({ invoiceNumberLabel: "INV-1", shopName: "S", amountCents: 100, successUrl: "s", cancelUrl: "c", metadata: { tenantId: 1, invoiceId: 1, paymentLinkId: 1 }, customerEmail: "nope" })));
  assert.equal(noEmail.get("customer_email"), null);
  assert.throws(() => checkoutSessionParams({ invoiceNumberLabel: "INV-1", shopName: "S", amountCents: 49, successUrl: "s", cancelUrl: "c", metadata: { tenantId: 1, invoiceId: 1, paymentLinkId: 1 } }));
});

test("stripe client posts form-encoded with the key and idempotency key (injected fetch)", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fakeFetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "cs_test_123", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_test_123", payment_status: "unpaid", status: "open", amount_total: 5000, currency: "usd", metadata: {}, payment_intent: null }), { status: 200 });
  };
  const client = stripeClient("sk_test_1234567890abcdef", fakeFetch);
  const s = await client.createCheckoutSession({ invoiceNumberLabel: "INV-5", shopName: "Shop", amountCents: 5000, successUrl: "https://x/s", cancelUrl: "https://x/c", metadata: { tenantId: 3, invoiceId: 5, paymentLinkId: 9 } }, "mp-paylink-3-9");
  assert.equal(s.id, "cs_test_123");
  assert.equal(calls[0]!.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(calls[0]!.init!.method, "POST");
  const h = calls[0]!.init!.headers as Record<string, string>;
  assert.equal(h.Authorization, "Bearer sk_test_1234567890abcdef");
  assert.equal(h["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(h["Idempotency-Key"], "mp-paylink-3-9");
  assert.equal(new URLSearchParams(String(calls[0]!.init!.body)).get("line_items[0][price_data][unit_amount]"), "5000");

  await client.getCheckoutSession("cs_test_123");
  assert.equal(calls[1]!.url, "https://api.stripe.com/v1/checkout/sessions/cs_test_123");
  assert.equal(calls[1]!.init!.method, "GET");
  assert.throws(() => client.getCheckoutSession("../v1/customers"));
});

test("stripe client turns errors into StripeError (API error vs network)", async () => {
  const denied = stripeClient("sk_test_1234567890abcdef", async () => new Response(JSON.stringify({ error: { message: "Invalid API Key provided", code: "api_key_invalid" } }), { status: 401 }));
  await assert.rejects(denied.getAccount(), (e: { status: number; network: boolean; message: string }) => e.status === 401 && !e.network && /Invalid API Key/.test(e.message));
  const offline = stripeClient("sk_test_1234567890abcdef", async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(offline.getAccount(), (e: { network: boolean }) => e.network === true);
  // A proxy/firewall page (not Stripe's JSON) counts as "couldn't reach Stripe".
  const blocked = stripeClient("sk_test_1234567890abcdef", async () => new Response("Forbidden", { status: 403 }));
  await assert.rejects(blocked.getAccount(), (e: { network: boolean; status: number }) => e.network === true && e.status === 403);
});

test("key formats", () => {
  assert.ok(isStripeSecretKey("sk_live_51Habcdefghijklmnop"));
  assert.ok(isStripeSecretKey("rk_test_51Habcdefghijklmnop"));
  assert.ok(!isStripeSecretKey("pk_live_51Habcdefghijklmnop"));
  assert.ok(!isStripeSecretKey("sk_live_short"));
  assert.ok(isWebhookSecret("whsec_abcdefghijklmnop"));
  assert.ok(!isWebhookSecret("sk_live_abcdefghijklmnop"));
  assert.equal(keyHint("sk_live_51Habcdefghijklmnop"), "sk_live_…mnop");
});

test("recording a paid session is decided once (idempotent)", () => {
  const session: Pick<CheckoutSession, "id" | "payment_status" | "amount_total" | "currency"> = { id: "cs_1", payment_status: "paid", amount_total: 2500, currency: "usd" };
  const open = { status: "open" as const, paymentId: null, providerRef: "cs_1" };
  assert.deepEqual(decideSession(session, open), { action: "record", amountCents: 2500 });
  // After it's recorded, webhook retries / polling / the thank-you page all see "already recorded".
  assert.deepEqual(decideSession(session, { status: "paid", paymentId: 9, providerRef: "cs_1" }), { action: "already_recorded" });
  assert.equal(decideSession({ ...session, payment_status: "unpaid" }, open).action, "ignore");
  assert.equal(decideSession(session, null).action, "ignore");
  assert.equal(decideSession(session, { ...open, providerRef: "cs_other" }).action, "ignore");
  assert.equal(decideSession({ ...session, currency: "eur" }, open).action, "ignore");
  assert.equal(decideSession({ ...session, amount_total: 0 }, open).action, "ignore");
});
