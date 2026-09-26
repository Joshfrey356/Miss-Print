-- Multi-tenancy: every print shop is a tenant; every business table gets tenant_id.
-- Existing data (if any) becomes tenant #1, named after the saved company profile.
-- Hand-ordered from drizzle-kit's output so it also works on a database that already has data.
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"logo_storage_key" text,
	"logo_mime_type" text,
	"logo_updated_at" timestamp with time zone,
	"next_job_number" integer DEFAULT 1001 NOT NULL,
	"next_quote_number" integer DEFAULT 1001 NOT NULL,
	"next_invoice_number" integer DEFAULT 1001 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
-- Existing single-shop data → tenant #1. A brand-new empty database gets no tenant here (/setup creates it).
INSERT INTO "tenants" ("id", "slug", "name", "next_job_number", "next_quote_number", "next_invoice_number")
SELECT 1,
  COALESCE(NULLIF(trim(both '-' from lower(regexp_replace(n.name, '[^a-zA-Z0-9]+', '-', 'g'))), ''), 'shop'),
  n.name,
  GREATEST(COALESCE((SELECT max("number") FROM "jobs"), 0) + 1, (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM "job_number_seq")),
  GREATEST(COALESCE((SELECT max("number") FROM "quotes"), 0) + 1, (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM "quote_number_seq")),
  GREATEST(COALESCE((SELECT max("number") FROM "invoices"), 0) + 1, (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM "invoice_number_seq"))
FROM (SELECT COALESCE(NULLIF(trim((SELECT "value"->>'name' FROM "company_settings" WHERE "key" = 'company')), ''), 'Miss Print') AS name) n
WHERE EXISTS (SELECT 1 FROM "users") OR EXISTS (SELECT 1 FROM "locations") OR EXISTS (SELECT 1 FROM "company_settings") OR EXISTS (SELECT 1 FROM "customers");
--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('"tenants"', 'id'), GREATEST((SELECT max("id") FROM "tenants"), 1), (SELECT count(*) > 0 FROM "tenants"));
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_number_unique";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_number_unique";
--> statement-breakpoint
ALTER TABLE "locations" DROP CONSTRAINT "locations_code_unique";
--> statement-breakpoint
ALTER TABLE "product_categories" DROP CONSTRAINT "product_categories_slug_unique";
--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_number_unique";
--> statement-breakpoint
ALTER TABLE "activity_logs" DROP CONSTRAINT "activity_logs_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "activity_logs" DROP CONSTRAINT "activity_logs_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "activity_logs" DROP CONSTRAINT "activity_logs_quote_id_quotes_id_fk";
--> statement-breakpoint
ALTER TABLE "activity_logs" DROP CONSTRAINT "activity_logs_actor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "calendar_events" DROP CONSTRAINT "calendar_events_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "calendar_events" DROP CONSTRAINT "calendar_events_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "calendar_events" DROP CONSTRAINT "calendar_events_location_id_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "calendar_events" DROP CONSTRAINT "calendar_events_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "communications" DROP CONSTRAINT "communications_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "communications" DROP CONSTRAINT "communications_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "communications" DROP CONSTRAINT "communications_quote_id_quotes_id_fk";
--> statement-breakpoint
ALTER TABLE "communications" DROP CONSTRAINT "communications_invoice_id_invoices_id_fk";
--> statement-breakpoint
ALTER TABLE "communications" DROP CONSTRAINT "communications_sent_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "company_settings" DROP CONSTRAINT "company_settings_updated_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "customer_contacts" DROP CONSTRAINT "customer_contacts_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "customers_salesperson_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_vendor_id_vendors_id_fk";
--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_receipt_file_id_files_id_fk";
--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_quote_id_quotes_id_fk";
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_uploaded_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_items" DROP CONSTRAINT "invoice_items_invoice_id_invoices_id_fk";
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "job_items" DROP CONSTRAINT "job_items_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "job_items" DROP CONSTRAINT "job_items_category_id_product_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "job_items" DROP CONSTRAINT "job_items_material_id_materials_id_fk";
--> statement-breakpoint
ALTER TABLE "job_status_history" DROP CONSTRAINT "job_status_history_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "job_status_history" DROP CONSTRAINT "job_status_history_changed_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_contact_id_customer_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_quote_id_quotes_id_fk";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_reorder_of_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_category_id_product_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_location_id_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_salesperson_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_designer_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_production_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_installer_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge_articles" DROP CONSTRAINT "knowledge_articles_updated_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "materials" DROP CONSTRAINT "materials_vendor_id_vendors_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_author_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_file_id_files_id_fk";
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_actor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_invoice_id_invoices_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_recorded_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "pricing_rules" DROP CONSTRAINT "pricing_rules_category_id_product_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "pricing_rules" DROP CONSTRAINT "pricing_rules_updated_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "product_categories" DROP CONSTRAINT "product_categories_default_location_id_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "proofs" DROP CONSTRAINT "proofs_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "proofs" DROP CONSTRAINT "proofs_file_id_files_id_fk";
--> statement-breakpoint
ALTER TABLE "proofs" DROP CONSTRAINT "proofs_sent_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "proofs" DROP CONSTRAINT "proofs_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "quote_items" DROP CONSTRAINT "quote_items_quote_id_quotes_id_fk";
--> statement-breakpoint
ALTER TABLE "quote_items" DROP CONSTRAINT "quote_items_category_id_product_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "quote_items" DROP CONSTRAINT "quote_items_material_id_materials_id_fk";
--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_contact_id_customer_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_salesperson_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_location_id_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_assigned_to_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_completed_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_location_id_locations_id_fk";
--> statement-breakpoint
/* 
    Unfortunately in current drizzle-kit version we can't automatically get name for primary key.
    We are working on making it available!

    Meanwhile you can:
        1. Check pk name in your database, by running
            SELECT constraint_name FROM information_schema.table_constraints
            WHERE table_schema = 'public'
                AND table_name = 'company_settings'
                AND constraint_type = 'PRIMARY KEY';
        2. Uncomment code below and paste pk name manually
        
    Hope to release this update as soon as possible
*/

-- ALTER TABLE "company_settings" DROP CONSTRAINT "<constraint_name>";
--> statement-breakpoint
ALTER TABLE "company_settings" DROP CONSTRAINT "company_settings_pkey";
--> statement-breakpoint
DROP INDEX "users_handle_idx";
--> statement-breakpoint
DROP INDEX "events_starts_idx";
--> statement-breakpoint
DROP INDEX "customers_phone_idx";
--> statement-breakpoint
DROP INDEX "expenses_date_idx";
--> statement-breakpoint
DROP INDEX "invoices_status_idx";
--> statement-breakpoint
DROP INDEX "jobs_status_idx";
--> statement-breakpoint
DROP INDEX "jobs_due_idx";
--> statement-breakpoint
DROP INDEX "messages_channel_idx";
--> statement-breakpoint
DROP INDEX "payments_received_idx";
--> statement-breakpoint
DROP INDEX "quotes_status_idx";
--> statement-breakpoint
-- Add tenant_id, filling existing rows with tenant #1, then require it to be given explicitly.
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "activity_logs" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "calendar_events" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "communications" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "company_settings" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "company_settings" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "customer_contacts" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "invoice_items" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "job_items" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "job_items" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "job_status_history" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "job_status_history" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "knowledge_articles" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "locations" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "materials" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "pricing_rules" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "product_categories" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "product_categories" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "proofs" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "proofs" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "quote_items" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "quote_items" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "tenant_id" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "vendors" ALTER COLUMN "tenant_id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_pkey" PRIMARY KEY("tenant_id","key");
--> statement-breakpoint
-- The app used to fall back to a built-in Miss Print profile; keep it for shop #1 as a real setting.
INSERT INTO "company_settings" ("tenant_id", "key", "value")
SELECT 1, 'company', '{"name":"Miss Print","tagline":"Print · Design · Signs","phone":"219-836-2517","email":"orders@missprintusa.com","website":"https://missprintusa.com","address":"8244 Calumet Ave, Munster, IN 46321","hours":"Mon–Fri 8:30–5:00 · Sat 9:00–12:00"}'::jsonb
WHERE EXISTS (SELECT 1 FROM "tenants" WHERE "id" = 1) AND NOT EXISTS (SELECT 1 FROM "company_settings" WHERE "key" = 'company');
--> statement-breakpoint
-- Numbers are now handed out per shop by the counters on tenants.
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "number" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "number" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "number" DROP DEFAULT;
--> statement-breakpoint
DROP SEQUENCE "public"."invoice_number_seq";
--> statement-breakpoint
DROP SEQUENCE "public"."job_number_seq";
--> statement-breakpoint
DROP SEQUENCE "public"."quote_number_seq";
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "activity_tenant_idx" ON "activity_logs" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_number_idx" ON "invoices" USING btree ("tenant_id","number");
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_tenant_number_idx" ON "jobs" USING btree ("tenant_id","number");
--> statement-breakpoint
CREATE UNIQUE INDEX "locations_tenant_code_idx" ON "locations" USING btree ("tenant_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_categories_tenant_slug_idx" ON "product_categories" USING btree ("tenant_id","slug");
--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_tenant_number_idx" ON "quotes" USING btree ("tenant_id","number");
--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_handle_idx" ON "users" USING btree ("tenant_id","handle");
--> statement-breakpoint
CREATE INDEX "events_starts_idx" ON "calendar_events" USING btree ("tenant_id","starts_at");
--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("tenant_id","phone");
--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("tenant_id","spent_on");
--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("tenant_id","due_date");
--> statement-breakpoint
CREATE INDEX "messages_channel_idx" ON "messages" USING btree ("tenant_id","channel","created_at");
--> statement-breakpoint
CREATE INDEX "payments_received_idx" ON "payments" USING btree ("tenant_id","received_on");
--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("tenant_id","status");
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_quote_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "public"."quotes"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_actor_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "events_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "events_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "events_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "events_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "comms_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "comms_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "comms_quote_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "public"."quotes"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "comms_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "comms_sent_by_fk" FOREIGN KEY ("tenant_id","sent_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "contacts_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_salesperson_fk" FOREIGN KEY ("tenant_id","salesperson_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vendor_fk" FOREIGN KEY ("tenant_id","vendor_id") REFERENCES "public"."vendors"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_receipt_fk" FOREIGN KEY ("tenant_id","receipt_file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_quote_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "public"."quotes"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_fk" FOREIGN KEY ("tenant_id","uploaded_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."product_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_material_fk" FOREIGN KEY ("tenant_id","material_id") REFERENCES "public"."materials"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_status_history" ADD CONSTRAINT "jsh_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_status_history" ADD CONSTRAINT "jsh_changed_by_fk" FOREIGN KEY ("tenant_id","changed_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."customer_contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_quote_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "public"."quotes"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_reorder_of_fk" FOREIGN KEY ("tenant_id","reorder_of_job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."product_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_salesperson_fk" FOREIGN KEY ("tenant_id","salesperson_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_designer_fk" FOREIGN KEY ("tenant_id","designer_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_production_fk" FOREIGN KEY ("tenant_id","production_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_installer_fk" FOREIGN KEY ("tenant_id","installer_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_vendor_fk" FOREIGN KEY ("tenant_id","vendor_id") REFERENCES "public"."vendors"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_fk" FOREIGN KEY ("tenant_id","author_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_fk" FOREIGN KEY ("tenant_id","recorded_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."product_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_location_fk" FOREIGN KEY ("tenant_id","default_location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_sent_by_fk" FOREIGN KEY ("tenant_id","sent_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "public"."quotes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."product_categories"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_material_fk" FOREIGN KEY ("tenant_id","material_id") REFERENCES "public"."materials"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."customer_contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_salesperson_fk" FOREIGN KEY ("tenant_id","salesperson_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_fk" FOREIGN KEY ("tenant_id","assigned_to") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_fk" FOREIGN KEY ("tenant_id","completed_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
