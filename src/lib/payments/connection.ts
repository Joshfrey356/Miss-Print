import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenantIntegrations, users } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { UserError } from "@/lib/actions";
import { openSecret, sealSecret, secretsConfigured } from "@/lib/secrets";
import { accountName, isLiveKey, isStripeSecretKey, isWebhookSecret, keyHint, stripeClient, StripeError, type FetchLike } from "./stripe";

/** What Settings shows about a shop's Stripe connection (no secrets). */
export type StripeConfig = { accountName: string | null; accountId: string | null; livemode: boolean; keyHint: string; checked: boolean };
type StripeSecret = { secretKey: string; webhookSecret: string };

export type StripeStatus =
  | { connected: false }
  | { connected: true; config: StripeConfig; connectedAt: Date; connectedByName: string | null; status: "connected" | "error"; lastError: string | null };

export async function getStripeStatus(tenantId: number): Promise<StripeStatus> {
  const [row] = await db
    .select({ i: tenantIntegrations, byName: users.name })
    .from(tenantIntegrations)
    .leftJoin(users, eq(users.id, tenantIntegrations.connectedBy))
    .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.provider, "stripe")));
  if (!row || row.i.status === "disconnected" || !row.i.secret) return { connected: false };
  return { connected: true, config: row.i.config as StripeConfig, connectedAt: row.i.connectedAt, connectedByName: row.byName, status: row.i.status, lastError: row.i.lastError };
}

/** The shop's Stripe keys, or null when Stripe isn't connected (or the keys can't be read). */
export async function getStripeKeys(tenantId: number): Promise<(StripeSecret & { config: StripeConfig }) | null> {
  const [row] = await db
    .select()
    .from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.provider, "stripe")));
  if (!row || row.status === "disconnected" || !row.secret) return null;
  try {
    return { ...openSecret<StripeSecret>(row.secret), config: row.config as StripeConfig };
  } catch (e) {
    console.error("[stripe] stored keys can't be opened (APP_SECRET_KEY changed?)", e);
    return null;
  }
}

export const stripeConnected = async (tenantId: number) => (await getStripeKeys(tenantId)) !== null;

/** A Stripe client for the shop, or a friendly error when it isn't connected. */
export async function stripeFor(tenantId: number, fetchImpl?: FetchLike) {
  const keys = await getStripeKeys(tenantId);
  if (!keys) throw new UserError("Card payments aren't set up. An owner can connect Stripe in Settings → Integrations.");
  return { client: stripeClient(keys.secretKey, fetchImpl), keys };
}

/**
 * Connect (or replace) the shop's Stripe keys. With `check`, the key is tried against Stripe first;
 * `check: false` saves without trying (e.g. when this server can't reach Stripe right now).
 */
export async function connectStripe(
  tenantId: number,
  input: { secretKey: string; webhookSecret: string; check: boolean },
  actor: { id: number; name: string },
  fetchImpl?: FetchLike,
): Promise<{ config: StripeConfig }> {
  const secretKey = input.secretKey.trim();
  const webhookSecret = input.webhookSecret.trim();
  if (!isStripeSecretKey(secretKey)) {
    if (/^pk_/.test(secretKey)) throw new UserError("That's the publishable key (pk_…). Paste the secret key — it starts with sk_live_ or sk_test_ (or a restricted key, rk_…).");
    throw new UserError("That doesn't look like a Stripe secret key. It starts with sk_live_, sk_test_ or rk_….");
  }
  if (!isWebhookSecret(webhookSecret)) throw new UserError("That doesn't look like a webhook signing secret. It starts with whsec_….");
  if (!secretsConfigured()) throw new UserError("This server has no APP_SECRET_KEY, so keys can't be stored safely. Ask whoever runs the server to set it, then try again.");

  const config: StripeConfig = { accountName: null, accountId: null, livemode: isLiveKey(secretKey), keyHint: keyHint(secretKey), checked: false };
  if (input.check) {
    const client = stripeClient(secretKey, fetchImpl);
    try {
      const acct = await client.getAccount();
      config.accountName = accountName(acct);
      config.accountId = acct.id;
      config.checked = true;
    } catch (e) {
      if (!(e instanceof StripeError)) throw e;
      if (e.network) throw new UserError("Couldn't reach Stripe to check the key. Check the internet connection, or use “Save without checking”.");
      if (e.status === 401) throw new UserError("Stripe didn't accept that key. Copy it again from Stripe → Developers → API keys.");
      if (e.status === 403) {
        // Restricted keys may not read the account; make sure they can use Checkout instead.
        try {
          await client.listCheckoutSessions();
          config.checked = true;
        } catch (e2) {
          throw new UserError(`This restricted key can't use Checkout. Give it “Checkout Sessions: Write” permission in Stripe. (${e2 instanceof Error ? e2.message : ""})`);
        }
      } else throw new UserError(`Stripe said: ${e.message}`);
    }
  }

  const secret = sealSecret({ secretKey, webhookSecret } satisfies StripeSecret);
  await db.transaction(async (tx) => {
    await tx
      .insert(tenantIntegrations)
      .values({ tenantId, provider: "stripe", config, secret, status: "connected", lastError: null, connectedBy: actor.id, connectedAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [tenantIntegrations.tenantId, tenantIntegrations.provider],
        set: { config, secret, status: "connected", lastError: null, connectedBy: actor.id, connectedAt: new Date(), updatedAt: new Date() },
      });
    await logActivity(
      {
        tenantId,
        action: "integration.connected",
        entityType: "setting",
        actorId: actor.id,
        summary: `Connected Stripe for card payments (${config.livemode ? "live" : "test mode"}${config.accountName ? ` · ${config.accountName}` : ""}${config.checked ? "" : " · not checked"})`,
        data: { provider: "stripe", keyHint: config.keyHint },
      },
      tx,
    );
  });
  return { config };
}

/** Disconnect: the keys are erased; the row stays (status "disconnected") for the record. */
export async function disconnectStripe(tenantId: number, actor: { id: number; name: string }) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(tenantIntegrations)
      .set({ status: "disconnected", secret: null, updatedAt: new Date() })
      .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.provider, "stripe")))
      .returning({ id: tenantIntegrations.id });
    if (!row) throw new UserError("Stripe isn't connected.");
    await logActivity({ tenantId, action: "integration.disconnected", entityType: "setting", actorId: actor.id, summary: "Disconnected Stripe (card payments)", data: { provider: "stripe" } }, tx);
  });
}

/** Remember the last Stripe problem so Settings can show it (e.g. the key was revoked). */
export async function noteStripeError(tenantId: number, message: string | null) {
  await db
    .update(tenantIntegrations)
    .set({ lastError: message, status: message ? "error" : "connected", updatedAt: new Date() })
    .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.provider, "stripe"), eq(tenantIntegrations.status, message ? "connected" : "error")));
}
