CREATE TABLE "batches" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"api_key_id" integer NOT NULL,
	"api" text NOT NULL,
	"endpoint" text NOT NULL,
	"models" text[] NOT NULL,
	"channel_id" integer,
	"upstream_id" text,
	"input_file_id" text,
	"request_count" integer NOT NULL,
	"status" text NOT NULL,
	"upstream" jsonb,
	"metadata" jsonb,
	"reservation_id" bigint,
	"cost" bigint DEFAULT 0 NOT NULL,
	"upstream_cost" bigint DEFAULT 0 NOT NULL,
	"last_polled_at" timestamp with time zone,
	"settling_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"purpose" text NOT NULL,
	"filename" text NOT NULL,
	"bytes" integer NOT NULL,
	"content" text,
	"batch_id" text,
	"channel_id" integer,
	"upstream_file_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "fixed_cost_hourly" double precision;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "capacity_tpm" integer;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "commitment_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "model_prices" ADD COLUMN "flex_markup" double precision;--> statement-breakpoint
ALTER TABLE "model_prices" ADD COLUMN "batch_markup" double precision;--> statement-breakpoint
ALTER TABLE "model_prices" ADD COLUMN "priority_multiplier" double precision;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "hold_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "service_tier" text;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batches_user_idx" ON "batches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "batches_settled_idx" ON "batches" USING btree ("settled_at");--> statement-breakpoint
CREATE INDEX "files_user_idx" ON "files" USING btree ("user_id","created_at");