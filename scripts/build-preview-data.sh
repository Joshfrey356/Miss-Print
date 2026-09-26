#!/usr/bin/env bash
# Regenerates preview/demo.sql.gz + preview/storage from the demo seed.
# Needs a local Postgres where the current DATABASE_URL user can create databases.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=mp_preview_build
BASE="${PREVIEW_BUILD_ADMIN_URL:-postgres://missprint:missprint@localhost:5432}"
psql "$BASE/postgres" -qc "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
rm -rf preview/storage
DATABASE_URL="$BASE/$DB" npx tsx scripts/migrate.ts
DATABASE_URL="$BASE/$DB" STORAGE_LOCAL_DIR=preview/storage npx tsx scripts/seed.ts
pg_dump "$BASE/$DB" --no-owner --no-privileges --inserts --rows-per-insert=500 --schema=public --schema=drizzle \
  | grep -vE '^\\(un)?restrict' \
  | grep -vE '^(CREATE SCHEMA public;|COMMENT ON SCHEMA public)' \
  | sed 's/^CREATE SCHEMA drizzle;/CREATE SCHEMA IF NOT EXISTS drizzle;/' \
  | gzip -9 > preview/demo.sql.gz
TZ=America/Chicago date +%Y-%m-%d > preview/seeded-on.txt  # the seed uses shop-local "today"
psql "$BASE/postgres" -qc "DROP DATABASE $DB"
echo "✓ preview/demo.sql.gz ($(du -h preview/demo.sql.gz | cut -f1)) seeded on $(cat preview/seeded-on.txt)"
