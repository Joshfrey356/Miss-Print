import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accountTokens, loginAttempts, sessions, tenants, users } from "@/lib/db/schema";
import { emailProvider, emailSendingEnabled } from "@/lib/email";
import { appUrl } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { hashPassword } from "@/lib/auth";

/**
 * One-time links emailed to people:
 * - "invite": a new team member chooses their own password (valid 7 days).
 * - "reset": "Forgot password?" (valid 2 hours).
 * Only a hash of each token is stored. Sending a new link cancels the person's older ones,
 * and using a link cancels the rest.
 */
export type LinkPurpose = "invite" | "reset";
const LIFETIME_MS: Record<LinkPurpose, number> = { invite: 7 * 24 * 60 * 60 * 1000, reset: 2 * 60 * 60 * 1000 };
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

type Person = { id: number; name: string; email: string; tenantId: number };

/** Outcome for the admin: whether the email went out, plus the link to share by hand if it didn't. */
export type SentLink = { emailed: boolean; link: string; error?: string };

/** Create a link for a person and email it from their shop. */
export async function sendAccountLink(person: Person, purpose: LinkPurpose, invitedBy?: string | null): Promise<SentLink> {
  const token = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    await tx
      .update(accountTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(accountTokens.userId, person.id), isNull(accountTokens.usedAt)));
    await tx.insert(accountTokens).values({ id: hashToken(token), userId: person.id, purpose, expiresAt: new Date(Date.now() + LIFETIME_MS[purpose]) });
    if (purpose === "invite") await tx.update(users).set({ invitedAt: new Date() }).where(and(eq(users.tenantId, person.tenantId), eq(users.id, person.id)));
  });

  const link = `${await appUrl()}/account/${token}`;
  const { company } = await getSettings(person.tenantId);
  const shop = company.name || "your shop";
  const first = person.name.split(" ")[0] || person.name;
  const email =
    purpose === "invite"
      ? {
          subject: `You're invited to ${shop}'s Command Center`,
          text: [
            `Hi ${first},`,
            ``,
            `${invitedBy ? `${invitedBy} added you` : "You've been added"} to ${shop}'s Command Center — where we keep jobs, quotes, customers and the production schedule.`,
            ``,
            `Choose your password to finish setting up your account:`,
            link,
            ``,
            `This link works for 7 days. You'll sign in with this email address: ${person.email}`,
            ``,
            `— ${shop}`,
          ].join("\n"),
        }
      : {
          subject: `Reset your ${shop} Command Center password`,
          text: [
            `Hi ${first},`,
            ``,
            `Use this link to choose a new password:`,
            link,
            ``,
            `It works for 2 hours. If you didn't ask for this, you can ignore this email — your password hasn't changed.`,
            ``,
            `— ${shop}`,
          ].join("\n"),
        };
  if (!emailSendingEnabled()) {
    // Email isn't set up on this server (EMAIL_PROVIDER / RESEND_API_KEY): log it and let the admin share the link.
    await emailProvider().send({ to: person.email, ...email, fromName: shop });
    return { emailed: false, link, error: "Email sending isn't set up on this server yet." };
  }
  const res = await emailProvider().send({ to: person.email, ...email, fromName: shop, replyTo: company.email || undefined });
  if (!res.ok) console.error("[account-link] email failed", res.error);
  return { emailed: res.ok, link, error: res.ok ? undefined : "The email couldn't be sent." };
}

/** The person a link belongs to, if the link is still good. */
export async function readAccountLink(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await db
    .select({ userId: users.id, name: users.name, email: users.email, tenantId: users.tenantId, purpose: accountTokens.purpose, lastLoginAt: users.lastLoginAt })
    .from(accountTokens)
    .innerJoin(users, eq(users.id, accountTokens.userId))
    .innerJoin(tenants, and(eq(tenants.id, users.tenantId), isNull(tenants.archivedAt)))
    // tenant-scope: found by a secret, globally unique token; the shop comes from its user.
    .where(and(eq(accountTokens.id, hashToken(token)), isNull(accountTokens.usedAt), gt(accountTokens.expiresAt, new Date()), eq(users.active, true)))
    .limit(1);
  return row ?? null;
}

/** Set the password from a link. Returns the email to sign in with, or null if the link is no longer good. */
export async function redeemAccountLink(token: string, password: string): Promise<string | null> {
  const link = await readAccountLink(token);
  if (!link) return null;
  const passwordHash = await hashPassword(password);
  const ok = await db.transaction(async (tx) => {
    // Claim the link atomically so it can only be used once.
    const [claimed] = await tx
      .update(accountTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(accountTokens.id, hashToken(token)), isNull(accountTokens.usedAt)))
      .returning({ id: accountTokens.id });
    if (!claimed) return false;
    await tx
      .update(accountTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(accountTokens.userId, link.userId), isNull(accountTokens.usedAt)));
    await tx.update(users).set({ passwordHash }).where(and(eq(users.tenantId, link.tenantId), eq(users.id, link.userId)));
    // A new password signs the person out everywhere else.
    await tx.delete(sessions).where(eq(sessions.userId, link.userId));
    return true;
  });
  return ok ? link.email : null;
}

/**
 * "Forgot password?": email a reset link if the address has an active account.
 * Always looks the same from outside, so it can't be used to find out who has an account.
 */
export async function requestPasswordReset(emailRaw: string, ip: string) {
  const email = emailRaw.trim().toLowerCase();
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(sql`${loginAttempts.key} in (${"reset:" + email}, ${"reset-ip:" + ip})`, gt(loginAttempts.createdAt, since)));
  if (n >= 5) return; // quietly stop after a few requests an hour
  await db.insert(loginAttempts).values([
    { key: "reset:" + email, success: true },
    { key: "reset-ip:" + ip, success: true },
  ]);
  const [person] = await db
    .select({ id: users.id, name: users.name, email: users.email, tenantId: users.tenantId })
    .from(users)
    .innerJoin(tenants, and(eq(tenants.id, users.tenantId), isNull(tenants.archivedAt)))
    // tenant-scope: sign-in emails are unique across all shops; the shop comes from the person.
    .where(and(sql`lower(${users.email}) = ${email}`, eq(users.active, true)))
    .limit(1);
  if (person) await sendAccountLink(person, "reset");
}
