import "./env";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
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
