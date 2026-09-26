-- Lock every app table behind Row Level Security.
-- The app connects as the table owner, which bypasses RLS, so nothing changes for the app.
-- With no policies, Supabase's public Data API (anon / authenticated keys) can't read or write these tables.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.schemaname, r.tablename);
  END LOOP;
END $$;
