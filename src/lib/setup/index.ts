import "server-only";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { db, isPreviewMode } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth";
import { insertBaseData } from "./base-data";

/**
 * First-run setup for a brand-new (empty) database, e.g. a fresh Supabase project.
 * Only available while the database has NO users; once the owner exists it is closed for good.
 */

/** Create/upgrade tables. Safe to run repeatedly (drizzle tracks applied migrations). */
export async function runMigrations() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
  try {
    // Trigram search indexes need pg_trgm (available on Supabase/Neon/RDS).
    await client`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle") });
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
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
    return { state: n === 0 ? "needs_setup" : "ready" };
  } catch (e) {
    console.error("[setup] database check failed", e);
    return { state: "db_error", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Migrate, load go-live reference data and create the owner — all or nothing. */
export async function runFirstTimeSetup(input: { name: string; email: string; password: string }) {
  const state = await getSetupState();
  if (state.state === "db_error") await runMigrations(); // e.g. tables missing in an unusual way — try anyway
  else if (state.state !== "needs_setup") throw new SetupClosedError();
  await runMigrations();
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    // Serialize concurrent setup attempts, then re-check inside the lock.
    await tx.execute(sql`select pg_advisory_xact_lock(4242001)`);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
    if (n > 0) throw new SetupClosedError();
    return insertBaseData(tx, { name: input.name, email: input.email.trim().toLowerCase(), passwordHash });
  });
}

export class SetupClosedError extends Error {
  constructor() {
    super("Setup is already complete. Sign in instead.");
  }
}
