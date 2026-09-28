ALTER TABLE "tenants" ADD COLUMN "job_prefix" text DEFAULT 'J' NOT NULL;--> statement-breakpoint
-- Existing shops: the original shop keeps "MP"; any others get their initials.
UPDATE "tenants" SET "job_prefix" = CASE WHEN "id" = 1 THEN 'MP' ELSE COALESCE(NULLIF(upper(array_to_string(ARRAY(SELECT left(w, 1) FROM regexp_split_to_table(regexp_replace("name", '[^A-Za-z ]', '', 'g'), '\s+') AS w WHERE w <> '' LIMIT 3), '')), ''), 'J') END;
