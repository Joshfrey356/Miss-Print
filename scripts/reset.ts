import "./env";
import postgres from "postgres";

// DEVELOPMENT ONLY: wipes the database schema.
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database.");
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
  await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;`);
  console.log("✓ Database reset");
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
