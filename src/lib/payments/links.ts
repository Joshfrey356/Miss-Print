import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { communications, customers, invoices, paymentLinks, payments, tenants } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { queueAccountingSync } from "@/lib/accounting";
import { notify } from "@/lib/notifications";
import { UserError } from "@/lib/actions";
import { emailProvider } from "@/lib/email";
import { appUrl } from "@/lib/http";
import { invoiceNo, money, today } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { balanceOf, recalcInvoicePaid } from "@/lib/money/service";
import { noteStripeError, stripeConnected, stripeFor } from "./connection";
import { decideSession, StripeError, type CheckoutSession, type FetchLike } from "./stripe";
import { payToken } from "./tokens";

type Actor = { id: number; name: string };

/** Smallest card charge Stripe accepts in USD. */
export const MIN_CARD_CENTS = 50;
/** Checkout links last 24 hours at Stripe; reuse an open one younger than this. */
const REUSE_MS = 20 * 3600 * 1000;

export type PayLink = { id: number; url: string; shortUrl: string; amountCents: number; status: "open" | "paid" | "expired"; invoiceId: number };

async function shopSlug(tenantId: number) {
  const [t] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
  return t?.slug ?? "";
}

/** The never-expiring "Pay online" page for an invoice (for emails), or null when Stripe isn't connected. */
export async function invoicePayUrl(tenantId: number, invoiceId: number): Promise<string | null> {
  if (!(await stripeConnected(tenantId))) return null;
  return `${await appUrl()}/pay/invoice/${payToken("invoice", tenantId, invoiceId)}`;
}

export const shortPayUrl = async (tenantId: number, linkId: number) => `${await appUrl()}/pay/l/${payToken("link", tenantId, linkId)}`;

/** QR code (SVG data URL) for a link, sized for a counter screen. */
export async function qrDataUrl(text: string) {
  const svg = await QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/**
 * Create a Stripe Checkout link for `amountCents` of an invoice's balance and store it in payment_links.
 * `returnTo` decides where the customer lands if they cancel: back to the invoice's pay page, or a
 * plain "no charge was made" page (at the counter).
 */
export async function createPaymentLink(
  tenantId: number,
  invoiceId: number,
  amountCents: number,
  actor: Actor | null,
  opts: { returnTo?: "invoice" | "counter"; fetch?: FetchLike } = {},
): Promise<PayLink> {
  const [row] = await db
    .select({ inv: invoices, customerName: customers.name, customerEmail: customers.email })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)));
  if (!row) throw new UserError("Invoice not found.");
  const { inv } = row;
  if (inv.status === "void") throw new UserError("This invoice is void.");
  const balance = balanceOf(inv);
  if (balance <= 0) throw new UserError("This invoice is already paid.");
  const amount = Math.round(amountCents);
  if (!(amount >= MIN_CARD_CENTS)) throw new UserError(`Card payments must be at least ${money(MIN_CARD_CENTS)}.`);
  if (amount > balance) throw new UserError(`That's more than the ${money(balance)} balance.`);

  const { client } = await stripeFor(tenantId, opts.fetch);

  // Reuse a recent open link for the same amount (e.g. the customer clicks the email link twice).
  const [recent] = await db
    .select()
    .from(paymentLinks)
    .where(
      and(
        eq(paymentLinks.tenantId, tenantId),
        eq(paymentLinks.invoiceId, invoiceId),
        eq(paymentLinks.status, "open"),
        eq(paymentLinks.amountCents, amount),
        gt(paymentLinks.createdAt, new Date(Date.now() - REUSE_MS)),
      ),
    )
    .orderBy(desc(paymentLinks.createdAt))
    .limit(1);
  if (recent && recent.url && !recent.providerRef.startsWith("pending:")) {
    return { id: recent.id, url: recent.url, shortUrl: await shortPayUrl(tenantId, recent.id), amountCents: amount, status: "open", invoiceId };
  }

  const [{ company }, slug, base] = await Promise.all([getSettings(tenantId), shopSlug(tenantId), appUrl()]);
  // Insert first so the link id can travel in Stripe's metadata; filled in once Stripe answers.
  const [link] = await db
    .insert(paymentLinks)
    .values({ tenantId, invoiceId, amountCents: amount, provider: "stripe", providerRef: `pending:${randomUUID()}`, url: "", status: "open", createdBy: actor?.id ?? null })
    .returning();
  const done = `${base}/pay/done?shop=${encodeURIComponent(slug)}`;
  let session: CheckoutSession;
  try {
    session = await client.createCheckoutSession(
      {
        invoiceNumberLabel: invoiceNo(inv.number),
        shopName: company.name,
        amountCents: amount,
        successUrl: `${done}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: opts.returnTo === "invoice" ? `${base}/pay/invoice/${payToken("invoice", tenantId, invoiceId)}` : `${done}&cancelled=1`,
        metadata: { tenantId, invoiceId, paymentLinkId: link!.id },
        customerEmail: row.customerEmail,
      },
      `mp-paylink-${tenantId}-${link!.id}`,
    );
  } catch (e) {
    await db.update(paymentLinks).set({ status: "expired" }).where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.id, link!.id)));
    if (e instanceof StripeError) {
      if (e.status === 401) await noteStripeError(tenantId, "Stripe no longer accepts the saved key. Reconnect Stripe with a new key.");
      throw new UserError(e.network ? "Couldn't reach Stripe. Check the internet connection and try again, or take the card on your terminal." : `Stripe said: ${e.message}`);
    }
    throw e;
  }
  if (!session.url) throw new UserError("Stripe didn't return a payment page. Please try again.");
  await db.transaction(async (tx) => {
    await tx.update(paymentLinks).set({ providerRef: session.id, url: session.url! }).where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.id, link!.id)));
    await logActivity(
      {
        tenantId,
        action: "invoice.pay_link_created",
        entityType: "invoice",
        entityId: inv.id,
        jobId: inv.jobId,
        customerId: inv.customerId,
        actorId: actor?.id ?? null,
        summary: `${actor ? "Created" : "Customer opened"} a card payment link for ${money(amount)} on ${invoiceNo(inv.number)}`,
        data: { paymentLinkId: link!.id },
      },
      tx,
    );
  });
  return { id: link!.id, url: session.url, shortUrl: await shortPayUrl(tenantId, link!.id), amountCents: amount, status: "open", invoiceId };
}

export type RecordOutcome = { result: "recorded" | "already_recorded" | "ignored"; reason?: string; invoiceId?: number; paymentId?: number | null };

/**
 * Record a paid Checkout Session as a payment — exactly once. Called by the webhook, by the
 * counter's "check status" polling and by the thank-you page; whichever comes first records it.
 * payments.processor_ref (the session id) is unique per shop, so a second insert is a no-op.
 */
export async function recordStripeSession(tenantId: number, session: CheckoutSession, via: "webhook" | "check" | "return"): Promise<RecordOutcome> {
  const outcome = await recordOnce(tenantId, session, via);
  // QuickBooks (if connected): same as payments recorded in Money.
  if (outcome.result === "recorded" && outcome.paymentId) await queueAccountingSync(tenantId, [{ type: "payment", id: outcome.paymentId }]);
  return outcome;
}

function recordOnce(tenantId: number, session: CheckoutSession, via: "webhook" | "check" | "return"): Promise<RecordOutcome> {
  return db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(paymentLinks)
      .where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.provider, "stripe"), eq(paymentLinks.providerRef, session.id)))
      .for("update");
    const decision = decideSession(session, link ?? null);
    if (decision.action === "ignore") return { result: "ignored", reason: decision.reason, invoiceId: link?.invoiceId };
    if (decision.action === "already_recorded") return { result: "already_recorded", invoiceId: link!.invoiceId, paymentId: link!.paymentId };

    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, link!.invoiceId))).for("update");
    if (!inv) return { result: "ignored", reason: "Invoice not found." };
    const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
    const [pay] = await tx
      .insert(payments)
      .values({
        tenantId,
        invoiceId: inv.id,
        customerId: inv.customerId,
        amountCents: decision.amountCents,
        method: "card",
        reference: "Online (Stripe)",
        receivedOn: today(),
        notes: [`Paid by card online${pi ? ` · ${pi}` : ""}`, inv.status === "void" ? "Invoice was void when this payment arrived — refund it in Stripe." : null].filter(Boolean).join("\n"),
        processorRef: session.id,
        recordedBy: null,
      })
      .onConflictDoNothing({ target: [payments.tenantId, payments.processorRef] })
      .returning();
    if (!pay) {
      // Recorded before (e.g. the link row was reset); just link it up.
      const [existing] = await tx.select({ id: payments.id }).from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.processorRef, session.id)));
      await tx.update(paymentLinks).set({ status: "paid", paymentId: existing?.id ?? null, paidAt: link!.paidAt ?? new Date() }).where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.id, link!.id)));
      return { result: "already_recorded", invoiceId: inv.id, paymentId: existing?.id ?? null };
    }
    await recalcInvoicePaid(tx, tenantId, inv.id);
    await tx.update(paymentLinks).set({ status: "paid", paymentId: pay.id, paidAt: new Date() }).where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.id, link!.id)));
    await logActivity(
      {
        tenantId,
        action: "payment.received",
        entityType: "payment",
        entityId: pay.id,
        jobId: inv.jobId,
        customerId: inv.customerId,
        actorId: null,
        summary: `Card payment of ${money(decision.amountCents)} received online (Stripe) on ${invoiceNo(inv.number)}`,
        data: { invoiceId: inv.id, paymentLinkId: link!.id, via },
      },
      tx,
    );
    await notify(
      { tenantId, userIds: [link!.createdBy, inv.createdBy], kind: "invoice", title: `Card payment received: ${money(decision.amountCents)} on ${invoiceNo(inv.number)}`, link: `/money/invoices/${inv.id}`, actorId: null },
      tx,
    );
    return { result: "recorded", invoiceId: inv.id, paymentId: pay.id };
  });
}

/** Counter polling / "check status": ask Stripe about a link and record it if it was paid. */
export async function checkPaymentLink(tenantId: number, linkId: number, fetchImpl?: FetchLike): Promise<{ status: "open" | "paid" | "expired"; paymentId: number | null }> {
  const [link] = await db.select().from(paymentLinks).where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.id, linkId)));
  if (!link) throw new UserError("Payment link not found.");
  if (link.status !== "open" || link.providerRef.startsWith("pending:")) return { status: link.status, paymentId: link.paymentId };
  const { client } = await stripeFor(tenantId, fetchImpl);
  let session: CheckoutSession;
  try {
    session = await client.getCheckoutSession(link.providerRef);
  } catch (e) {
    if (e instanceof StripeError) return { status: "open", paymentId: null }; // try again on the next poll
    throw e;
  }
  if (session.payment_status === "paid") {
    const r = await recordStripeSession(tenantId, session, "check");
    return { status: r.result === "ignored" ? "open" : "paid", paymentId: r.paymentId ?? null };
  }
  if (session.status === "expired") {
    await db.update(paymentLinks).set({ status: "expired" }).where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.id, link.id), eq(paymentLinks.status, "open")));
    return { status: "expired", paymentId: null };
  }
  return { status: "open", paymentId: null };
}

/** Stop offering a link at the counter (the customer paid another way). Stripe's page just expires. */
export async function cancelPaymentLink(tenantId: number, linkId: number) {
  await db.update(paymentLinks).set({ status: "expired" }).where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.id, linkId), eq(paymentLinks.status, "open")));
}

/** Email the customer a "Pay online" link for an invoice's balance. */
export async function emailPayLink(tenantId: number, invoiceId: number, to: string, actor: Actor) {
  const [row] = await db
    .select({ inv: invoices, customerName: customers.name })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)));
  if (!row) throw new UserError("Invoice not found.");
  const balance = balanceOf(row.inv);
  if (row.inv.status === "void") throw new UserError("This invoice is void.");
  if (balance <= 0) throw new UserError("This invoice is already paid.");
  if (balance < MIN_CARD_CENTS) throw new UserError(`Card payments must be at least ${money(MIN_CARD_CENTS)}.`);
  const url = await invoicePayUrl(tenantId, invoiceId);
  if (!url) throw new UserError("Card payments aren't set up. An owner can connect Stripe in Settings → Integrations.");
  const { company } = await getSettings(tenantId);
  const inv = invoiceNo(row.inv.number);
  const subject = `Pay invoice ${inv} online — ${company.name}`;
  const text = [
    `Hi ${row.customerName},`,
    "",
    `You can pay invoice ${inv} (balance ${money(balance)}) by card here:`,
    url,
    "",
    "The payment page is secure and run by Stripe. You'll get a receipt by email.",
    "",
    `Questions? Just reply to this email${company.phone ? ` or call ${company.phone}` : ""}.`,
    "",
    "Thank you for your business!",
    company.name,
    [company.phone, company.email, company.website].filter(Boolean).join(" · "),
  ].join("\n");
  const result = await emailProvider().send({ to, subject, text, fromName: company.name, replyTo: company.email || undefined });
  await db.transaction(async (tx) => {
    await tx.insert(communications).values({
      tenantId,
      customerId: row.inv.customerId,
      jobId: row.inv.jobId,
      invoiceId: row.inv.id,
      channel: "email",
      direction: "outbound",
      template: "pay_link",
      toAddress: to,
      subject,
      body: text,
      status: result.ok ? "sent" : "failed",
      providerId: result.providerId ?? null,
      sentBy: actor.id,
    });
    if (result.ok)
      await logActivity(
        { tenantId, action: "invoice.pay_link_sent", entityType: "invoice", entityId: row.inv.id, jobId: row.inv.jobId, customerId: row.inv.customerId, actorId: actor.id, summary: `Emailed a “Pay online” link for ${inv} (${money(balance)}) to ${to}` },
        tx,
      );
  });
  if (!result.ok) {
    console.error("[pay link email]", result.error);
    throw new UserError("The email couldn't be sent. Please try again in a few minutes.");
  }
  return { to, url };
}
