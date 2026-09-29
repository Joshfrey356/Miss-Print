import "server-only";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db";
import { customerContacts, customers, loginAttempts, portalLinks, portalSessions, tenants } from "@/lib/db/schema";
import { emailProvider, emailSendingEnabled } from "@/lib/email";
import { appUrl } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { getTenant } from "@/lib/tenant";
import { getPortalSettings } from "./settings";
import { logActivity } from "@/lib/activity";
import { UserError } from "@/lib/actions";
import { hashPortalToken, isPortalToken, LINK_DAYS, linkExpiry, linkState, newPortalToken, normalizeEmail, safePortalNext, sessionExpiry, type LinkState } from "./tokens";

type Actor = { id: number; name: string } | null;

// ---------------------------------------------------------------------------
// Creating links
// ---------------------------------------------------------------------------
/** Store a new sign-in link (hashed) for a customer + email and return the raw token. */
export async function createPortalLink(
  tx: Tx | typeof db,
  tenantId: number,
  input: { customerId: number; contactId: number | null; email: string; createdBy: number | null; days?: number },
): Promise<string> {
  const token = newPortalToken();
  await tx.insert(portalLinks).values({
    tenantId,
    customerId: input.customerId,
    contactId: input.contactId,
    email: normalizeEmail(input.email),
    tokenHash: hashPortalToken(token),
    expiresAt: linkExpiry(input.days ?? LINK_DAYS),
    createdBy: input.createdBy,
  });
  return token;
}

export async function portalLinkUrl(token: string, next?: string | null) {
  const n = next ? safePortalNext(next) : null;
  return `${await appUrl()}/portal/login/${token}${n && n !== "/portal/home" ? `?next=${encodeURIComponent(n)}` : ""}`;
}

/** The shop's branded portal sign-in page, e.g. https://app.example.com/portal?shop=miss-print */
export async function portalHomeUrl(tenantId: number) {
  const t = await getTenant(tenantId);
  return `${await appUrl()}/portal${t ? `?shop=${t.slug}` : ""}`;
}

/**
 * Staff turned portal access off for this email: its newest link is revoked. A new invite (a fresh,
 * un-revoked link) turns it back on.
 */
export async function portalAccessBlocked(tenantId: number, customerId: number, email: string) {
  const [latest] = await db
    .select({ revokedAt: portalLinks.revokedAt })
    .from(portalLinks)
    .where(and(eq(portalLinks.tenantId, tenantId), eq(portalLinks.customerId, customerId), eq(portalLinks.email, normalizeEmail(email))))
    .orderBy(desc(portalLinks.id))
    .limit(1);
  return Boolean(latest?.revokedAt);
}

/** The contact at this customer with this email, if any (so the portal can greet them by name). */
export async function contactForEmail(tenantId: number, customerId: number, email: string) {
  const [c] = await db
    .select({ id: customerContacts.id, name: customerContacts.name })
    .from(customerContacts)
    .where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.customerId, customerId), isNull(customerContacts.archivedAt), sql`lower(${customerContacts.email}) = ${normalizeEmail(email)}`))
    .limit(1);
  return c ?? null;
}

function signInEmail(opts: { shop: string; phone: string; first: string | null; customerName: string; link: string; portalUrl: string; invitedBy?: string | null }) {
  const { shop } = opts;
  return {
    subject: opts.invitedBy ? `Your ${shop} customer portal` : `Your sign-in link for ${shop}`,
    text: [
      `Hi${opts.first ? ` ${opts.first}` : ""},`,
      ``,
      opts.invitedBy
        ? `${opts.invitedBy} at ${shop} set you up with our customer portal for ${opts.customerName}. There you can check on your orders, approve proofs, accept quotes, pay invoices, send us artwork and reorder in a few taps.`
        : `Here is your link to sign in to ${shop}'s customer portal for ${opts.customerName}:`,
      ``,
      opts.invitedBy ? `Sign in here (no password needed):` : null,
      opts.link,
      ``,
      `The link works once, for ${LINK_DAYS} days. After that, go to ${opts.portalUrl} and enter your email to get a new one.`,
      opts.invitedBy ? null : `If you didn't ask for this, you can ignore this email.`,
      ``,
      `— ${shop}${opts.phone ? ` · ${opts.phone}` : ""}`,
    ]
      .filter((l) => l !== null)
      .join("\n"),
  };
}

export type SentPortalLink = { emailed: boolean; link: string; error?: string };

/** Staff: "Invite to portal" — email a branded sign-in link to a contact (or any email) of a customer. */
export async function invitePortalUser(tenantId: number, customerId: number, input: { contactId: number | null; email: string }, actor: { id: number; name: string }): Promise<SentPortalLink> {
  const email = normalizeEmail(input.email);
  if (!(await getPortalSettings(tenantId)).enabled) throw new UserError("The customer portal is off. Turn it on in Settings → Customer Portal first.");
  const [cust] = await db.select({ id: customers.id, name: customers.name }).from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId), isNull(customers.archivedAt)));
  if (!cust) throw new UserError("Customer not found.");
  let contact: { id: number; name: string } | null = null;
  if (input.contactId) {
    const [c] = await db
      .select({ id: customerContacts.id, name: customerContacts.name })
      .from(customerContacts)
      .where(and(eq(customerContacts.tenantId, tenantId), eq(customerContacts.customerId, customerId), eq(customerContacts.id, input.contactId), isNull(customerContacts.archivedAt)));
    if (!c) throw new UserError("Contact not found.");
    contact = c;
  } else contact = await contactForEmail(tenantId, customerId, email);

  const token = await db.transaction(async (tx) => {
    const t = await createPortalLink(tx, tenantId, { customerId, contactId: contact?.id ?? null, email, createdBy: actor.id });
    await logActivity({ tenantId, action: "portal.invited", entityType: "customer", entityId: customerId, customerId, actorId: actor.id, summary: `Invited ${contact?.name ? `${contact.name} (${email})` : email} to the customer portal` }, tx);
    return t;
  });
  const link = await portalLinkUrl(token);
  const { company } = await getSettings(tenantId);
  const shop = company.name || "Your print shop";
  const msg = signInEmail({ shop, phone: company.phone, first: contact?.name.split(" ")[0] ?? null, customerName: cust.name, link, portalUrl: await portalHomeUrl(tenantId), invitedBy: actor.name });
  const res = await emailProvider().send({ to: email, ...msg, fromName: shop, replyTo: company.email || undefined });
  if (!emailSendingEnabled()) return { emailed: false, link, error: "Email sending isn't set up on this server yet." };
  if (!res.ok) console.error("[portal invite] email failed", res.error);
  return { emailed: res.ok, link, error: res.ok ? undefined : "The email couldn't be sent." };
}

// ---------------------------------------------------------------------------
// "Email me a sign-in link" (the customer asks on /portal)
// ---------------------------------------------------------------------------
const HOUR = 60 * 60 * 1000;

/** True when this email or IP asked too often (5 per email / 20 per IP an hour). Records this attempt. */
export async function portalLinkRateLimited(email: string, ip: string) {
  const since = new Date(Date.now() - HOUR);
  const rows = await db
    .select({ key: loginAttempts.key, n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(sql`${loginAttempts.key} in (${"portal:" + email}, ${"portal-ip:" + ip})`, gt(loginAttempts.createdAt, since)))
    .groupBy(loginAttempts.key);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.n]));
  const limited = (byKey["portal:" + email] ?? 0) >= 5 || (byKey["portal-ip:" + ip] ?? 0) >= 20;
  await db.insert(loginAttempts).values([
    { key: "portal:" + email, success: !limited },
    { key: "portal-ip:" + ip, success: !limited },
  ]);
  return limited;
}

/**
 * Every customer account (in any shop) this email belongs to: the customer's own email or one of its
 * contacts. Archived customers, contacts and shops don't count.
 */
async function accountsForEmail(email: string) {
  const viaCustomer = await db
    .select({ tenantId: customers.tenantId, customerId: customers.id, customerName: customers.name, contactId: sql<number | null>`null::int`, contactName: sql<string | null>`null::text` })
    .from(customers)
    .innerJoin(tenants, and(eq(tenants.id, customers.tenantId), isNull(tenants.archivedAt)))
    // tenant-scope: a customer asking for a sign-in link doesn't know the shop yet; each match carries its own shop.
    .where(and(sql`lower(${customers.email}) = ${email}`, isNull(customers.archivedAt)))
    .limit(10);
  const viaContact = await db
    .select({ tenantId: customerContacts.tenantId, customerId: customers.id, customerName: customers.name, contactId: customerContacts.id, contactName: customerContacts.name })
    .from(customerContacts)
    .innerJoin(customers, and(eq(customers.tenantId, customerContacts.tenantId), eq(customers.id, customerContacts.customerId), isNull(customers.archivedAt)))
    .innerJoin(tenants, and(eq(tenants.id, customerContacts.tenantId), isNull(tenants.archivedAt)))
    // tenant-scope: as above; the contact's own shop comes with it.
    .where(and(sql`lower(${customerContacts.email}) = ${email}`, isNull(customerContacts.archivedAt)))
    .limit(10);
  type Account = { tenantId: number; customerId: number; customerName: string; contactId: number | null; contactName: string | null };
  const out = new Map<string, Account>();
  for (const r of [...viaContact, ...viaCustomer]) {
    const key = `${r.tenantId}:${r.customerId}`;
    if (!out.has(key)) out.set(key, r);
  }
  return [...out.values()].slice(0, 10);
}

/**
 * Email a sign-in link for each customer account the email belongs to, branded per shop.
 * Says nothing about whether the email was found (the caller always shows the same message).
 */
export async function sendSignInLinks(emailRaw: string) {
  const email = normalizeEmail(emailRaw);
  const accounts = await accountsForEmail(email);
  for (const a of accounts) {
    // Shops that turned the portal off send nothing.
    if (!(await getPortalSettings(a.tenantId)).enabled) continue;
    if (await portalAccessBlocked(a.tenantId, a.customerId, email)) continue;
    const token = await createPortalLink(db, a.tenantId, { customerId: a.customerId, contactId: a.contactId, email, createdBy: null });
    const link = await portalLinkUrl(token);
    const { company } = await getSettings(a.tenantId);
    const shop = company.name || "Your print shop";
    const msg = signInEmail({ shop, phone: company.phone, first: a.contactName?.split(" ")[0] ?? null, customerName: a.customerName, link, portalUrl: await portalHomeUrl(a.tenantId) });
    const res = await emailProvider().send({ to: email, ...msg, fromName: shop, replyTo: company.email || undefined });
    if (!res.ok) console.error("[portal sign-in link] email failed", res.error);
  }
}

// ---------------------------------------------------------------------------
// Using a link
// ---------------------------------------------------------------------------
export type PortalLinkInfo = {
  /** "off": the shop turned its customer portal off. */
  state: LinkState | "off";
  tenantId: number | null;
  customerId: number | null;
  customerName: string | null;
  email: string | null;
  contactName: string | null;
};

/** What a sign-in link is (without using it) — for the "Sign in to …" page. */
export async function readPortalLink(token: string): Promise<PortalLinkInfo> {
  const none: PortalLinkInfo = { state: "missing", tenantId: null, customerId: null, customerName: null, email: null, contactName: null };
  if (!isPortalToken(token)) return none;
  const [row] = await db
    .select({ link: portalLinks, customerName: customers.name, customerArchived: customers.archivedAt, contactName: customerContacts.name, contactArchived: customerContacts.archivedAt })
    .from(portalLinks)
    .innerJoin(tenants, and(eq(tenants.id, portalLinks.tenantId), isNull(tenants.archivedAt)))
    .innerJoin(customers, and(eq(customers.tenantId, portalLinks.tenantId), eq(customers.id, portalLinks.customerId)))
    .leftJoin(customerContacts, and(eq(customerContacts.tenantId, portalLinks.tenantId), eq(customerContacts.id, portalLinks.contactId)))
    // tenant-scope: found by the hash of its secret, globally unique token; the link carries its shop.
    .where(eq(portalLinks.tokenHash, hashPortalToken(token)))
    .limit(1);
  if (!row) return none;
  const gone = row.customerArchived || (row.link.contactId && row.contactArchived);
  const off = !(await getPortalSettings(row.link.tenantId)).enabled;
  return {
    state: off ? "off" : gone ? "revoked" : linkState(row.link),
    tenantId: row.link.tenantId,
    customerId: row.link.customerId,
    customerName: row.customerName,
    email: row.link.email,
    contactName: row.contactName,
  };
}

/**
 * Use a sign-in link: claim it (once), start a portal session and return the session's raw token.
 * Returns null when the link can't be used any more.
 */
export async function redeemPortalLink(token: string, meta: { ip: string | null; userAgent: string | null }): Promise<{ sessionToken: string; tenantId: number; customerId: number } | null> {
  if (!isPortalToken(token)) return null;
  const info = await readPortalLink(token);
  if (info.state !== "ok") return null;
  const sessionToken = newPortalToken();
  return db.transaction(async (tx) => {
    // Claim atomically so a link works only once, even with a double click.
    // tenant-scope: found by the hash of its secret token.
    const [link] = await tx
      .update(portalLinks)
      .set({ usedAt: new Date() })
      .where(and(eq(portalLinks.tokenHash, hashPortalToken(token)), isNull(portalLinks.usedAt), isNull(portalLinks.revokedAt), gt(portalLinks.expiresAt, new Date())))
      .returning();
    if (!link) return null;
    await tx.insert(portalSessions).values({
      id: hashPortalToken(sessionToken),
      tenantId: link.tenantId,
      customerId: link.customerId,
      contactId: link.contactId,
      email: link.email,
      expiresAt: sessionExpiry(),
      lastSeenAt: new Date(),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { sessionToken, tenantId: link.tenantId, customerId: link.customerId };
  });
}

/** Sign out: remove these sessions (by raw cookie tokens). */
export async function endPortalSessions(tokens: string[]) {
  if (!tokens.length) return;
  // tenant-scope: sessions are found by the hashes of their secret tokens.
  await db.delete(portalSessions).where(inArray(portalSessions.id, tokens.map(hashPortalToken)));
}

// ---------------------------------------------------------------------------
// Staff: who has access, turning it off
// ---------------------------------------------------------------------------
export type PortalAccessRow = {
  email: string;
  contactName: string | null;
  invitedAt: Date | null;
  lastVisit: Date | null;
  signedIn: boolean;
  blocked: boolean;
};

/** Emails that were given portal access for a customer (invited or signed in), newest activity first. */
export async function listPortalAccess(tenantId: number, customerId: number): Promise<PortalAccessRow[]> {
  const [links, sessions] = await Promise.all([
    db
      .select({ id: portalLinks.id, email: portalLinks.email, createdBy: portalLinks.createdBy, createdAt: portalLinks.createdAt, revokedAt: portalLinks.revokedAt, contactName: customerContacts.name })
      .from(portalLinks)
      .leftJoin(customerContacts, and(eq(customerContacts.tenantId, portalLinks.tenantId), eq(customerContacts.id, portalLinks.contactId)))
      .where(and(eq(portalLinks.tenantId, tenantId), eq(portalLinks.customerId, customerId)))
      .orderBy(desc(portalLinks.id)),
    db
      .select({ email: portalSessions.email, lastSeenAt: portalSessions.lastSeenAt, createdAt: portalSessions.createdAt, expiresAt: portalSessions.expiresAt })
      .from(portalSessions)
      // Staff previews aren't customer visits.
      .where(and(eq(portalSessions.tenantId, tenantId), eq(portalSessions.customerId, customerId), isNull(portalSessions.previewBy))),
  ]);
  const byEmail = new Map<string, PortalAccessRow>();
  for (const l of links) {
    let row = byEmail.get(l.email);
    if (!row) {
      // Links come newest first: the first one decides whether access is on.
      row = { email: l.email, contactName: l.contactName, invitedAt: null, lastVisit: null, signedIn: false, blocked: Boolean(l.revokedAt) };
      byEmail.set(l.email, row);
    }
    if (l.createdBy && !l.revokedAt && (!row.invitedAt || l.createdAt > row.invitedAt)) row.invitedAt = l.createdAt;
    if (!row.contactName && l.contactName) row.contactName = l.contactName;
  }
  const now = Date.now();
  for (const s of sessions) {
    const row = byEmail.get(s.email) ?? { email: s.email, contactName: null, invitedAt: null, lastVisit: null, signedIn: false, blocked: false };
    const seen = s.lastSeenAt ?? s.createdAt;
    if (!row.lastVisit || seen > row.lastVisit) row.lastVisit = seen;
    if (s.expiresAt.getTime() > now) row.signedIn = true;
    byEmail.set(s.email, row);
  }
  // Only people who were invited or have signed in (a self-service link that was never used isn't "access").
  return [...byEmail.values()]
    .filter((r) => r.invitedAt || r.lastVisit || r.blocked)
    .sort((a, b) => Number(a.blocked) - Number(b.blocked) || (b.lastVisit ?? b.invitedAt ?? new Date(0)).getTime() - (a.lastVisit ?? a.invitedAt ?? new Date(0)).getTime());
}

/** Staff: turn off portal access for one email at a customer — revoke its links and sign it out everywhere. */
export async function revokePortalAccess(tenantId: number, customerId: number, emailRaw: string, actor: Actor) {
  const email = normalizeEmail(emailRaw);
  await db.transaction(async (tx) => {
    const revoked = await tx
      .update(portalLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(portalLinks.tenantId, tenantId), eq(portalLinks.customerId, customerId), eq(portalLinks.email, email), isNull(portalLinks.revokedAt)))
      .returning({ id: portalLinks.id });
    if (!revoked.length) {
      // Nothing to revoke (e.g. they only signed in with an older, used link): leave a revoked marker so
      // "Email me a sign-in link" stays off for them until someone invites them again.
      await tx.insert(portalLinks).values({ tenantId, customerId, email, tokenHash: hashPortalToken(newPortalToken()), expiresAt: new Date(), revokedAt: new Date(), createdBy: actor?.id ?? null });
    }
    await tx.delete(portalSessions).where(and(eq(portalSessions.tenantId, tenantId), eq(portalSessions.customerId, customerId), eq(portalSessions.email, email)));
    await logActivity({ tenantId, action: "portal.access_removed", entityType: "customer", entityId: customerId, customerId, actorId: actor?.id ?? null, summary: `Turned off customer portal access for ${email}` }, tx);
  });
}

/**
 * The cookie's token list after signing in: the new session first, other customers kept (so the browser
 * can switch between them), and an older session for the same customer replaced (and ended).
 */
export async function tokensAfterSignIn(existing: string[], newToken: string, tenantId: number, customerId: number): Promise<string[]> {
  const others = existing.filter((t) => t !== newToken);
  if (!others.length) return [newToken];
  const rows = await db
    .select({ id: portalSessions.id, tenantId: portalSessions.tenantId, customerId: portalSessions.customerId })
    .from(portalSessions)
    // tenant-scope: this browser's own sessions, found by the hashes of their secret tokens.
    .where(inArray(portalSessions.id, others.map(hashPortalToken)));
  const same = new Set(rows.filter((r) => r.tenantId === tenantId && r.customerId === customerId).map((r) => r.id));
  const live = new Set(rows.map((r) => r.id));
  if (same.size) await endPortalSessions(others.filter((t) => same.has(hashPortalToken(t))));
  return [newToken, ...others.filter((t) => live.has(hashPortalToken(t)) && !same.has(hashPortalToken(t)))];
}
