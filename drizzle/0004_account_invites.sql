CREATE TABLE "account_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_tokens_user_idx" ON "account_tokens" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "account_tokens" ENABLE ROW LEVEL SECURITY;
