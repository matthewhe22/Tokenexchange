CREATE TABLE "redeem_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"code_prefix" text NOT NULL,
	"amount" bigint NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"batch" text,
	"expires_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redeem_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "model_prices" ADD COLUMN "tier_threshold" integer;--> statement-breakpoint
ALTER TABLE "model_prices" ADD COLUMN "tier_input_price" double precision;--> statement-breakpoint
ALTER TABLE "model_prices" ADD COLUMN "tier_output_price" double precision;--> statement-breakpoint
ALTER TABLE "model_prices" ADD COLUMN "per_request_price" double precision;