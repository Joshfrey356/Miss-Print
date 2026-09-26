import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

/**
 * PREVIEW MODE — used only when no DATABASE_URL is configured.
 *
 * Runs an in-memory Postgres (PGlite) loaded with the made-up demo data from
 * preview/demo.sql.gz, with every date shifted so the demo always looks "current".
 * Nothing here is real data, and changes are lost when the server restarts.
 * As soon as DATABASE_URL is set, the app uses the real database and preview mode is off.
 */
export const isPreviewMode = () => !process.env.DATABASE_URL;

export function createPreviewClient(): PGlite {
  const root = process.cwd();
  const sql = gunzipSync(readFileSync(path.join(root, "preview/demo.sql.gz"))).toString("utf8");
  const seededOn = readFileSync(path.join(root, "preview/seeded-on.txt"), "utf8").trim();
  const todayChicago = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const days = Math.round((Date.parse(todayChicago) - Date.parse(seededOn)) / 86400000);

  const client = new PGlite({ extensions: { pg_trgm } });
  // PGlite runs queries one at a time in order, so app queries wait until this finishes.
  client
    .exec(
      `CREATE EXTENSION IF NOT EXISTS pg_trgm;
       ${sql}
       SET search_path TO public;
       DO $$ DECLARE r record; BEGIN
         FOR r IN SELECT table_name, column_name, data_type FROM information_schema.columns
                  WHERE table_schema = 'public' AND data_type IN ('date', 'timestamp with time zone') LOOP
           IF r.data_type = 'date' THEN
             EXECUTE format('UPDATE %I SET %I = %I + %s WHERE %I IS NOT NULL', r.table_name, r.column_name, r.column_name, ${days}, r.column_name);
           ELSE
             EXECUTE format('UPDATE %I SET %I = %I + make_interval(days => %s) WHERE %I IS NOT NULL', r.table_name, r.column_name, r.column_name, ${days}, r.column_name);
           END IF;
         END LOOP;
       END $$;`,
    )
    .then(() => console.info(`[preview] demo database ready (dates shifted ${days} days)`))
    .catch((e) => console.error("[preview] failed to load demo data", e));
  return client;
}
