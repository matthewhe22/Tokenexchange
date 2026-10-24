CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"actor_email" text,
	"action" text NOT NULL,
	"target" text,
	"details" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"multiplier" double precision DEFAULT 1 NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "auto_disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "group_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_last_step" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "low_balance_threshold" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "low_balance_notified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_group_id_pricing_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."pricing_groups"("id") ON DELETE set null ON UPDATE no action;