import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerContacts, customers, portalSessions, tenants } from "@/lib/db/schema";
import { UserError } from "@/lib/actions";
import { getPortalSettings } from "./settings";
import { hashPortalToken, PORTAL_COOKIE, portalCookieHeaders, readCookieTokens, sessionTouch, writeCookieTokens } from "./tokens";

/**
 * A signed-in customer. Every portal query is scoped by BOTH `tenantId` (the shop) and `customerId`
 * (the customer's account at that shop) from this object — never by ids from the URL alone.
 */
export type PortalSession = {
  /** Hash of the cookie token (portal_sessions.id). */
  id: string;
  tenantId: number;
  customerId: number;
  contactId: number | null;
  email: string;
  /** The person: the contact's name, else the customer's name. */
  name: string;
  customerName: string;
  shopName: string;
};

/**
 * Every portal account in this browser's cookie that is still valid, including ones at shops that
 * turned their portal off (`portalOn` false). Cached per request.
 */
const getCookieAccounts = cache(async (): Promise<(PortalSession & { portalOn: boolean; shopSlug: string })[]> => {
  const tokens = readCookieTokens((await cookies()).get(PORTAL_COOKIE)?.value);
  if (!tokens.length) return [];
  const ids = tokens.map(hashPortalToken);
  const now = new Date();
  const rows = await db
    .select({
      id: portalSessions.id,
      tenantId: portalSessions.tenantId,
      customerId: portalSessions.customerId,
      contactId: portalSessions.contactId,
      email: portalSessions.email,
      expiresAt: portalSessions.expiresAt,
      lastSeenAt: portalSessions.lastSeenAt,
      customerName: customers.name,
      contactName: customerContacts.name,
      contactArchived: customerContacts.archivedAt,
      shopName: tenants.name,
      shopSlug: tenants.slug,
    })
    .from(portalSessions)
    .innerJoin(tenants, and(eq(tenants.id, portalSessions.tenantId), isNull(tenants.archivedAt)))
    .innerJoin(customers, and(eq(customers.tenantId, portalSessions.tenantId), eq(customers.id, portalSessions.customerId), isNull(customers.archivedAt)))
    .leftJoin(customerContacts, and(eq(customerContacts.tenantId, portalSessions.tenantId), eq(customerContacts.id, portalSessions.contactId)))
    // portal_sessions is looked up by the hash of the secret cookie token (like staff sessions); it carries its shop.
    .where(and(inArray(portalSessions.id, ids), gt(portalSessions.expiresAt, now)));
  const valid = rows.filter((r) => !(r.contactId && r.contactArchived));
  const ordered = ids.map((id) => valid.find((r) => r.id === id)).filter((r): r is (typeof valid)[number] => Boolean(r));
  const on = new Map(await Promise.all([...new Set(ordered.map((r) => r.tenantId))].map(async (t) => [t, (await getPortalSettings(t)).enabled] as const)));
  // Sliding expiry + "last visit" for the active account (at most every 10 minutes).
  const active = ordered.find((r) => on.get(r.tenantId));
  const touch = active ? sessionTouch(active, now) : null;
  // tenant-scope: the session row is found by its secret token hash.
  if (active && touch) await db.update(portalSessions).set(touch).where(eq(portalSessions.id, active.id));
  return ordered.map((r) => ({ id: r.id, tenantId: r.tenantId, customerId: r.customerId, contactId: r.contactId, email: r.email, name: r.contactName || r.customerName, customerName: r.customerName, shopName: r.shopName, shopSlug: r.shopSlug, portalOn: on.get(r.tenantId) ?? false }));
});

/** Every portal account this browser can use (first = active). A shop that turned its portal off refuses its sessions. */
export const getPortalAccounts = cache(async (): Promise<PortalSession[]> =>
  (await getCookieAccounts()).filter((a) => a.portalOn).map(({ portalOn: _p, shopSlug: _s, ...a }) => a),
);

export async function getPortalSession(): Promise<PortalSession | null> {
  return (await getPortalAccounts())[0] ?? null;
}

/** For portal pages: the signed-in customer, or back to the portal sign-in page. */
export async function requirePortal(): Promise<PortalSession> {
  const s = await getPortalSession();
  if (s) return s;
  // Signed in only at a shop whose portal is off: show that shop's "not available" page.
  const off = (await getCookieAccounts()).find((a) => !a.portalOn);
  redirect(off ? `/portal?shop=${encodeURIComponent(off.shopSlug)}` : "/portal?signedOut=1");
}

/** Same-origin check for portal Server Actions (CSRF), using the request's Origin and Host headers. */
export async function assertSameOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  let ok = false;
  try {
    ok = Boolean(origin && host && new URL(origin).host === host);
  } catch {
    ok = false;
  }
  if (!ok) throw new UserError("Please reload the page and try again.");
}

/** For portal Server Actions: same origin + signed in. */
export async function requirePortalAction(): Promise<PortalSession> {
  await assertSameOrigin();
  const s = await getPortalSession();
  if (!s) throw new UserError("You've been signed out. Please sign in again.");
  return s;
}

export async function portalClientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function portalUserAgent() {
  return (await headers()).get("user-agent")?.slice(0, 300) ?? null;
}

/** Set-Cookie headers for route handlers (the cookie lives on two paths: /portal and /api/portal). */
export function portalCookies(tokens: string[]): string[] {
  return portalCookieHeaders(writeCookieTokens(tokens), { secure: process.env.NODE_ENV === "production" });
}

/** The raw tokens in this request's portal cookie. */
export async function cookieTokens(): Promise<string[]> {
  return readCookieTokens((await cookies()).get(PORTAL_COOKIE)?.value);
}
