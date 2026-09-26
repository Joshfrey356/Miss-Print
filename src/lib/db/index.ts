import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import postgres from "postgres";
import * as schema from "./schema";
import { createPreviewClient, isPreviewMode } from "./preview";

type Database = PostgresJsDatabase<typeof schema>;

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres>; db?: Database };

/**
 * Connect on first use (not at import), so `next build` works without DATABASE_URL.
 * With no DATABASE_URL the app runs in PREVIEW MODE on built-in demo data (see ./preview.ts).
 */
function getDb(): Database {
  if (globalForDb.db) return globalForDb.db;
  if (isPreviewMode()) {
    // Same query API; the preview database only ever holds demo data.
    const d = drizzlePglite(createPreviewClient(), { schema });
    // postgres-js returns raw rows as an array; PGlite returns { rows }. Normalize to the array form.
    const execute = d.execute.bind(d);
    (d as unknown as { execute: unknown }).execute = async (q: Parameters<typeof execute>[0]) => (await execute(q)).rows;
    globalForDb.db = d as unknown as Database;
    return globalForDb.db;
  }
  const client = globalForDb.pg ?? postgres(process.env.DATABASE_URL!, { max: Number(process.env.DATABASE_POOL_SIZE ?? 10), prepare: false });
  globalForDb.pg = client;
  globalForDb.db = drizzle(client, { schema });
  return globalForDb.db;
}

export const db = new Proxy({} as Database, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
export type DB = Database;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export { schema, isPreviewMode };
