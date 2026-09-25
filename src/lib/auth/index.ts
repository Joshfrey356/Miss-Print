import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { loginAttempts, sessions, users, type User } from "@/lib/db/schema";
import { can, type Permission } from "@/lib/permissions";

export const SESSION_COOKIE = "mp_session";
const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export type SessionUser = Pick<User, "id" | "name" | "handle" | "email" | "role" | "color" | "locationId" | "title">;

export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

// ---------------------------------------------------------------------------
// Rate limiting: max 10 failed attempts per email / 30 per IP in 15 minutes.
// ---------------------------------------------------------------------------
async function isRateLimited(email: string, ip: string) {
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const rows = await db
    .select({ key: loginAttempts.key, n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        sql`${loginAttempts.key} in (${"email:" + email}, ${"ip:" + ip})`,
        eq(loginAttempts.success, false),
        gt(loginAttempts.createdAt, since),
      ),
    )
    .groupBy(loginAttempts.key);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.n]));
  return (byKey["email:" + email] ?? 0) >= 10 || (byKey["ip:" + ip] ?? 0) >= 30;
}

export async function signIn(
  emailRaw: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = emailRaw.trim().toLowerCase();
  const ip = await clientIp();
  if (await isRateLimited(email, ip)) {
    return { ok: false, error: "Too many attempts. Please wait 15 minutes and try again." };
  }
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  // Always run bcrypt so response time doesn't reveal whether the email exists.
  const valid = await verifyPassword(password, user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
  const success = Boolean(user && user.active && valid);
  await db.insert(loginAttempts).values([
    { key: "email:" + email, success },
    { key: "ip:" + ip, success },
  ]);
  if (!user || !success) return { ok: false, error: "That email and password don't match." };

  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  await db.insert(sessions).values({
    id: hashToken(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_DAYS * DAY),
    ip,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return { ok: true };
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

/** Current signed-in user, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = hashToken(token);
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      handle: users.handle,
      email: users.email,
      role: users.role,
      color: users.color,
      locationId: users.locationId,
      title: users.title,
      active: users.active,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);
  if (!row || !row.active || row.expiresAt.getTime() < Date.now()) return null;
  // Sliding expiration: extend when less than half the lifetime remains.
  if (row.expiresAt.getTime() - Date.now() < (SESSION_DAYS / 2) * DAY) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_DAYS * DAY) })
      .where(eq(sessions.id, id));
  }
  const { active: _a, expiresAt: _e, ...user } = row;
  return user;
});

/** Use in pages/layouts/actions: redirects to /login when not signed in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
  }
}

/** Throws ForbiddenError when the user's role lacks the permission. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) throw new ForbiddenError();
  return user;
}

/** For pages: render the "no access" screen instead of throwing. */
export async function requirePagePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/no-access");
  return user;
}

export function userCan(user: SessionUser, permission: Permission) {
  return can(user.role, permission);
}
