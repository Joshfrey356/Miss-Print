ALTER TYPE "public"."pricing_method" ADD VALUE 'sheet_fed' BEFORE 'custom';--> statement-breakpoint
CREATE TABLE "accounting_sync" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"external_id" text,
	"sync_token" text,
	"synced_at" timestamp with time zone,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_sync_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"location_id" integer,
	"max_sheet_width_in" numeric(8, 3),
	"max_sheet_height_in" numeric(8, 3),
	"min_sheet_width_in" numeric(8, 3),
	"min_sheet_height_in" numeric(8, 3),
	"gripper_in" numeric(6, 3) DEFAULT 0.25 NOT NULL,
	"max_colors" integer DEFAULT 4 NOT NULL,
	"perfecting" boolean DEFAULT false NOT NULL,
	"color_click_price_cents" numeric(10, 4),
	"color_click_cost_cents" numeric(10, 4),
	"bw_click_price_cents" numeric(10, 4),
	"bw_click_cost_cents" numeric(10, 4),
	"plate_price_cents" integer,
	"plate_cost_cents" integer,
	"ink_cost_per_m_cents" integer,
	"setup_minutes" integer DEFAULT 0 NOT NULL,
	"sheets_per_hour" integer,
	"hourly_price_cents" integer,
	"hourly_cost_cents" integer,
	"setup_spoilage_sheets" integer DEFAULT 0 NOT NULL,
	"run_spoilage_pct" numeric(6, 4) DEFAULT 0 NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "equipment_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" integer,
	CONSTRAINT "imports_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'bindery' NOT NULL,
	"basis" text NOT NULL,
	"setup_price_cents" integer DEFAULT 0 NOT NULL,
	"setup_cost_cents" integer DEFAULT 0 NOT NULL,
	"rate_price_cents" numeric(12, 4) DEFAULT 0 NOT NULL,
	"rate_cost_cents" numeric(12, 4) DEFAULT 0 NOT NULL,
	"pieces_per_hour" integer,
	"minimum_cents" integer DEFAULT 0 NOT NULL,
	"equipment_id" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "operations_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "payment_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"provider_ref" text NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"payment_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payment_links_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "register_closes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"location_id" integer,
	"business_date" date NOT NULL,
	"expected_cash_cents" integer NOT NULL,
	"counted_cash_cents" integer NOT NULL,
	"totals" jsonb NOT NULL,
	"notes" text,
	"closed_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "register_closes_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "tenant_integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"provider" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"connected_by" integer,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_integrations_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD COLUMN "import_id" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "import_id" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "source" text DEFAULT 'job' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_items" ADD COLUMN "pricing_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "legacy_number" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "import_id" integer;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "sheet_width_in" numeric(8, 3);--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "sheet_height_in" numeric(8, 3);--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "weight" text;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "cost_per_m_cents" integer;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "markup_pct" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "import_id" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "processor_ref" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "tendered_cents" integer;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "import_id" integer;--> statement-breakpoint
ALTER TABLE "accounting_sync" ADD CONSTRAINT "accounting_sync_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_undone_by_fk" FOREIGN KEY ("tenant_id","undone_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_equipment_fk" FOREIGN KEY ("tenant_id","equipment_id") REFERENCES "public"."equipment"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_created_by_fk" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_closes" ADD CONSTRAINT "register_closes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_closes" ADD CONSTRAINT "register_closes_location_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_closes" ADD CONSTRAINT "register_closes_closed_by_fk" FOREIGN KEY ("tenant_id","closed_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_integrations" ADD CONSTRAINT "tenant_integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_integrations" ADD CONSTRAINT "tenant_integrations_connected_by_fk" FOREIGN KEY ("tenant_id","connected_by") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_sync_entity_idx" ON "accounting_sync" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_links_provider_ref_idx" ON "payment_links" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "payment_links_invoice_idx" ON "payment_links" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "register_closes_date_idx" ON "register_closes" USING btree ("tenant_id","business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_integrations_provider_idx" ON "tenant_integrations" USING btree ("tenant_id","provider");--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "contacts_import_fk" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."imports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_import_fk" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."imports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_import_fk" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."imports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_import_fk" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."imports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_import_fk" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."imports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_processor_ref_idx" ON "payments" USING btree ("tenant_id","processor_ref");