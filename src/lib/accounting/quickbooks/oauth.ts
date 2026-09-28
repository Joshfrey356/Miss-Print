/**
 * QuickBooks Online OAuth 2.0 (pure — no database, fetch is injectable for tests).
 *
 * - `state` is signed (HMAC-SHA256) and expires after 10 minutes. It names the user and shop that
 *   started the connection plus a random nonce that is ALSO kept in an httpOnly cookie, so the
 *   callback only accepts a code for the same person, shop and browser.
 * - Tokens: access tokens last about an hour; refresh tokens rotate (Intuit may return a new one on
 *   every refresh), so the caller must save whatever comes back.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { QBO_AUTHORIZE_URL, QBO_REVOKE_URL, QBO_SCOPE, qboTokenUrl, type QboAppConfig } from "./config";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** What we keep (sealed) in tenant_integrations.secret. Times are epoch milliseconds. */
export type QboTokens = { accessToken: string; refreshToken: string; expiresAt: number; refreshExpiresAt: number };

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
export type OAuthState = { tenantId: number; userId: number; nonce: string; exp: number };
export const STATE_TTL_MS = 10 * 60 * 1000;

export const newNonce = () => randomBytes(16).toString("base64url");

const sign = (payload: string, key: Buffer | string) => createHmac("sha256", key).update(payload).digest("base64url");

export function signState(s: OAuthState, key: Buffer | string): string {
  const payload = Buffer.from(JSON.stringify({ t: s.tenantId, u: s.userId, n: s.nonce, e: s.exp })).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

export type StateCheck = { ok: true; state: OAuthState } | { ok: false; reason: "invalid" | "expired" | "mismatch" };

/** Verify signature, expiry, and that it belongs to this user, shop and browser (nonce cookie). */
export function verifyState(
  raw: string | null | undefined,
  key: Buffer | string,
  expect: { tenantId: number; userId: number; nonce: string | null | undefined },
  now = Date.now(),
): StateCheck {
  if (!raw) return { ok: false, reason: "invalid" };
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return { ok: false, reason: "invalid" };
  const want = Buffer.from(sign(payload, key));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "invalid" };
  let p: { t?: unknown; u?: unknown; n?: unknown; e?: unknown };
  try {
    p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (typeof p.t !== "number" || typeof p.u !== "number" || typeof p.n !== "string" || typeof p.e !== "number") return { ok: false, reason: "invalid" };
  if (p.e < now) return { ok: false, reason: "expired" };
  if (p.t !== expect.tenantId || p.u !== expect.userId || !expect.nonce || p.n !== expect.nonce) return { ok: false, reason: "mismatch" };
  return { ok: true, state: { tenantId: p.t, userId: p.u, nonce: p.n, exp: p.e } };
}

export function authorizeUrl(app: Pick<QboAppConfig, "clientId">, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: app.clientId, response_type: "code", scope: QBO_SCOPE, redirect_uri: redirectUri, state });
  return `${QBO_AUTHORIZE_URL}?${q.toString()}`;
}

// ---------------------------------------------------------------------------
// token endpoint
// ---------------------------------------------------------------------------
export class QboAuthError extends Error {
  /** true when the shop has to connect again (refresh token expired or was revoked). */
  constructor(message: string, readonly reconnect: boolean) {
    super(message);
  }
}

const basic = (app: Pick<QboAppConfig, "clientId" | "clientSecret">) => `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`;

type TokenJson = { access_token?: string; refresh_token?: string; expires_in?: number; x_refresh_token_expires_in?: number; error?: string; error_description?: string };

export function tokensFromResponse(j: TokenJson, now = Date.now()): QboTokens {
  if (!j.access_token || !j.refresh_token) throw new QboAuthError("QuickBooks didn't send back a sign-in token.", false);
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: now + (j.expires_in ?? 3600) * 1000,
    refreshExpiresAt: now + (j.x_refresh_token_expires_in ?? 100 * 86400) * 1000,
  };
}

async function tokenCall(fetchFn: FetchLike, app: QboAppConfig, body: Record<string, string>, now: number): Promise<QboTokens> {
  let res: Response;
  try {
    res = await fetchFn(qboTokenUrl(), {
      method: "POST",
      headers: { Authorization: basic(app), Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new QboAuthError("Couldn't reach QuickBooks to sign in. Check the internet connection and try again.", false);
  }
  const j = (await res.json().catch(() => ({}))) as TokenJson;
  if (!res.ok) {
    if (j.error === "invalid_grant")
      throw new QboAuthError(
        body.grant_type === "refresh_token"
          ? "QuickBooks sign-in expired or was revoked. Connect to QuickBooks again in Settings → Integrations."
          : "That QuickBooks sign-in link was already used or expired. Please try connecting again.",
        body.grant_type === "refresh_token",
      );
    if (j.error === "invalid_client") throw new QboAuthError("QuickBooks rejected this server's app keys (QUICKBOOKS_CLIENT_ID / SECRET).", false);
    throw new QboAuthError(`QuickBooks sign-in failed (${res.status}${j.error ? `: ${j.error}` : ""}).`, false);
  }
  return tokensFromResponse(j, now);
}

/** Trade the one-time code from the callback for tokens. */
export function exchangeCode(fetchFn: FetchLike, app: QboAppConfig, code: string, redirectUri: string, now = Date.now()) {
  return tokenCall(fetchFn, app, { grant_type: "authorization_code", code, redirect_uri: redirectUri }, now);
}

/** Get a fresh access token. The refresh token may rotate — always save the result. */
export function refreshTokens(fetchFn: FetchLike, app: QboAppConfig, refreshToken: string, now = Date.now()) {
  return tokenCall(fetchFn, app, { grant_type: "refresh_token", refresh_token: refreshToken }, now);
}

/** Revoke our access (disconnect). Best effort: returns false if QuickBooks couldn't be reached. */
export async function revokeToken(fetchFn: FetchLike, app: QboAppConfig, token: string): Promise<boolean> {
  try {
    const res = await fetchFn(QBO_REVOKE_URL, {
      method: "POST",
      headers: { Authorization: basic(app), Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Treat a token as expired a minute early so a request never starts with a token about to lapse. */
export const accessTokenExpired = (t: QboTokens, now = Date.now()) => t.expiresAt - 60_000 <= now;
