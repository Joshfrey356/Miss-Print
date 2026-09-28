/**
 * Customer portal: sign-in link and session tokens. Pure (no database, no "server-only"), so it can be
 * unit-tested; it uses node:crypto, so import it from server code only.
 *
 * - A sign-in link carries a random token; only its SHA-256 hash is stored (portal_links.token_hash).
 *   It works once, for LINK_DAYS (links in quote emails: QUOTE_LINK_DAYS), unless revoked.
 * - Using it starts a portal session: another random token in the "mp_portal" cookie, stored hashed
 *   (portal_sessions.id), valid SESSION_DAYS and extended while in use (sliding).
 * - One browser can be signed in to several customers (e.g. a person who orders for two companies):
 *   the cookie holds up to MAX_ACCOUNTS tokens joined with ".", the first one is the active customer.
 */
import { createHash, randomBytes } from "node:crypto";

export const PORTAL_COOKIE = "mp_portal";
/** The cookie is only sent to the portal pages and the portal API, never to the staff app. */
export const PORTAL_COOKIE_PATHS = ["/portal", "/api/portal"] as const;
export const LINK_DAYS = 7;
export const QUOTE_LINK_DAYS = 30;
export const SESSION_DAYS = 60;
export const MAX_ACCOUNTS = 5;
const DAY = 24 * 60 * 60 * 1000;

export const hashPortalToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newPortalToken = () => randomBytes(32).toString("base64url");
/** 32 random bytes as base64url = 43 characters. Anything else is never looked up. */
export const isPortalToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{43}$/.test(t);

export type LinkState = "ok" | "missing" | "expired" | "used" | "revoked";

/** Whether a sign-in link can still be used. Revoked beats used beats expired. */
export function linkState(link: { expiresAt: Date; usedAt: Date | null; revokedAt: Date | null } | null | undefined, now = new Date()): LinkState {
  if (!link) return "missing";
  if (link.revokedAt) return "revoked";
  if (link.usedAt) return "used";
  if (link.expiresAt.getTime() <= now.getTime()) return "expired";
  return "ok";
}

export const linkExpiry = (days: number, now = new Date()) => new Date(now.getTime() + days * DAY);
export const sessionExpiry = (now = new Date()) => new Date(now.getTime() + SESSION_DAYS * DAY);

/**
 * Sliding sessions without a write on every page view: extend the expiry (and note the visit) when the
 * last one is more than 10 minutes old.
 */
export function sessionTouch(s: { expiresAt: Date; lastSeenAt: Date | null }, now = new Date()): { expiresAt: Date; lastSeenAt: Date } | null {
  const stale = !s.lastSeenAt || now.getTime() - s.lastSeenAt.getTime() > 10 * 60 * 1000;
  return stale ? { expiresAt: sessionExpiry(now), lastSeenAt: now } : null;
}

/** Tokens from the cookie: well-formed, no duplicates, at most MAX_ACCOUNTS. The first is the active one. */
export function readCookieTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(".").filter(isPortalToken))].slice(0, MAX_ACCOUNTS);
}

export function writeCookieTokens(tokens: string[]): string {
  return [...new Set(tokens.filter(isPortalToken))].slice(0, MAX_ACCOUNTS).join(".");
}

/**
 * The browser keeps the cookie for 400 days (the most browsers allow); whether it still works is decided on
 * the server by portal_sessions.expires_at, which slides while the customer uses the portal.
 */
export const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** One Set-Cookie header value per portal path (a cookie has a single path, so it's set twice). */
export function portalCookieHeaders(value: string, opts: { secure: boolean }): string[] {
  const maxAge = value ? COOKIE_MAX_AGE_SECONDS : 0;
  return PORTAL_COOKIE_PATHS.map((path) =>
    [`${PORTAL_COOKIE}=${value}`, `Path=${path}`, `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Lax", opts.secure ? "Secure" : null].filter(Boolean).join("; "),
  );
}

/** Where to go after signing in: only pages inside the portal (no open redirects). */
export function safePortalNext(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return "/portal/home";
  if (!/^\/portal\/[A-Za-z0-9/_-]*(\?[A-Za-z0-9=&_%-]*)?$/.test(next) || next.includes("//") || next.startsWith("/portal/login")) return "/portal/home";
  return next;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
