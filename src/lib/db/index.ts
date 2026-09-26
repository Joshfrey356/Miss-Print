import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres>; db?: Database };

/**
 * Connect on first use (not at import), so `next build` works without DATABASE_URL
 * and a missing URL fails with a clear message at runtime.
 */
function getDb(): Database {
  if (globalForDb.db) return globalForDb.db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local (or add it in your host's environment variables).");
  const client = globalForDb.pg ?? postgres(url, { max: Number(process.env.DATABASE_POOL_SIZE ?? 10), prepare: false });
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
export { schema };
