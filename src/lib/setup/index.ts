import "server-only";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, isPreviewMode, type Tx } from "@/lib/db";
import { loginAttempts, tenants, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth";
import { saveSetting } from "@/lib/admin/settings-store";
import { DEFAULT_COMPANY } from "@/lib/settings";
import { uniqueSlug } from "@/lib/tenant";
import { insertBaseData } from "./base-data";

/**
 * Creating shops (tenants).
 * - First-run setup for a brand-new (empty) database, e.g. a fresh Supabase project. Only
 *   available while the database has NO users; once the first owner exists it is closed for good.
 * - Sign-up (/signup): any other print shop creates its own account, with its own data.
 */

export type NewShop = { shopName: string; name: string; email: string; password: string; phone?: string | null; address?: string | null };

/** Create a shop with starter data and its owner account. Runs inside the caller's transaction. */
async function createShop(tx: Tx, input: NewShop, passwordHash: string) {
  const [tenant] = await tx
    .insert(tenants)
    .values({ name: input.shopName, slug: await uniqueSlug(tx, input.shopName) })
    .returning();
  const result = await insertBaseData(tx, tenant!.id, { name: input.name, email: input.email, passwordHash }, { phone: input.phone, address: input.address });
  await saveSetting(
    tenant!.id,
    "company",
    { ...DEFAULT_COMPANY, name: input.shopName, phone: input.phone ?? "", email: input.email, address: input.address ?? "" },
    result.owner.id,
    tx,
  );
  return { tenant: tenant!, ...result };
}

/** Create/upgrade tables. Safe to run repeatedly (drizzle tracks applied migrations). */
export async function runMigrations() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
  try {
    // Trigram search indexes need pg_trgm (available on Supabase/Neon/RDS).
    await client`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    // Keep every table (including ones added later) closed to Supabase's public Data API.
    await client.unsafe(`DO $$ DECLARE r record; BEGIN FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity LOOP EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.schemaname, r.tablename); END LOOP; END $$`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

export type SetupState = "preview" | "needs_setup" | "ready" | "db_error";

/** Is this a real, empty database that still needs its owner account? */
export async function getSetupState(): Promise<{ state: SetupState; error?: string }> {
  if (isPreviewMode()) return { state: "preview" };
  try {
    const rows = await db.execute<{ exists: boolean }>(sql`select to_regclass('public.users') is not null as exists`);
    if (!rows[0]?.exists) return { state: "needs_setup" };
    // tenant-scope: setup is only open while there are no people in ANY shop.
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
    return { state: n === 0 ? "needs_setup" : "ready" };
  } catch (e) {
    console.error("[setup] database check failed", e);
    return { state: "db_error", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Migrate, create the first shop with its starter data and owner — all or nothing. */
export async function runFirstTimeSetup(input: NewShop) {
  const state = await getSetupState();
  if (state.state === "db_error") await runMigrations(); // e.g. tables missing in an unusual way — try anyway
  else if (state.state !== "needs_setup") throw new SetupClosedError();
  await runMigrations();
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    // Serialize concurrent setup attempts, then re-check inside the lock.
    await tx.execute(sql`select pg_advisory_xact_lock(4242001)`);
    // tenant-scope: setup is only open while there are no people in ANY shop.
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
    if (n > 0) throw new SetupClosedError();
    return createShop(tx, { ...input, email: input.email.trim().toLowerCase() }, passwordHash);
  });
}

/** Is self-service sign-up for new shops turned on? (Off in preview mode and with SIGNUP_DISABLED=1.) */
export function signupMode(): "open" | "code" | "off" {
  if (isPreviewMode() || process.env.SIGNUP_DISABLED === "1") return "off";
  return process.env.SIGNUP_CODE?.trim() ? "code" : "open";
}

/** A new print shop signs up. Throws SignupError with a message the person can act on. */
export async function signUpShop(input: NewShop & { code?: string | null }, ip: string) {
  const mode = signupMode();
  if (mode === "off") throw new SignupError("New shop sign-up is turned off.");
  if (mode === "code" && input.code?.trim() !== process.env.SIGNUP_CODE!.trim()) throw new SignupError("That sign-up code isn't right.");
  // At most 5 new shops per hour from one address.
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.key, "signup:" + ip), gt(loginAttempts.createdAt, since)));
  if (n >= 5) throw new SignupError("Too many new shops from this network. Please try again in an hour.");

  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  // tenant-scope: emails are unique across all shops (your email decides which shop you sign in to).
  const taken = async (q: Tx | typeof db) => (await q.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1)).length > 0;
  if (await taken(db)) throw new SignupError("That email already has an account. Sign in instead, or use a different email.");
  await db.insert(loginAttempts).values({ key: "signup:" + ip, success: true });
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(4242002)`);
      if (await taken(tx)) throw new SignupError("That email already has an account. Sign in instead, or use a different email.");
      return createShop(tx, { ...input, email }, passwordHash);
    });
  } catch (e) {
    if (e instanceof SignupError) throw e;
    console.error("[signup] failed", e);
    throw new SignupError("Sign-up couldn't finish. Please try again.");
  }
}

export class SignupError extends Error {}

export class SetupClosedError extends Error {
  constructor() {
    super("Setup is already complete. Sign in instead.");
  }
}
