import "./env";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/**
 * `npm run db:migrate`           — migrate the database in DATABASE_URL.
 * `tsx scripts/migrate.ts --deploy` (part of `npm run build`) — only migrates on Vercel
 * PRODUCTION builds with a database configured, so schema changes ship with each deploy.
 * Preview/branch builds and local builds never touch the database.
 */
async function main() {
  if (process.argv.includes("--deploy")) {
    if (!process.env.DATABASE_URL || process.env.VERCEL_ENV !== "production") {
      console.log("Skipping database migration (only runs on Vercel production builds with DATABASE_URL set).");
      return;
    }
  }
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
  // Trigram search indexes need pg_trgm (available on Supabase/Neon/RDS).
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("✓ Database migrated");
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
