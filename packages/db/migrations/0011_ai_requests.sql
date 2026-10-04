CREATE TYPE "public"."ai_request_outcome" AS ENUM('success', 'invalid_output', 'timeout', 'rate_limited', 'upstream_error', 'circuit_open', 'budget_exceeded', 'not_configured');--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text NOT NULL,
	"outcome" "ai_request_outcome" NOT NULL,
	"model" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd_micros" integer,
	"query_length" smallint NOT NULL,
	"filters" jsonb,
	CONSTRAINT "ai_requests_attempts_range" CHECK ("ai_requests"."attempts" BETWEEN 0 AND 2),
	CONSTRAINT "ai_requests_latency_positive" CHECK ("ai_requests"."latency_ms" >= 0),
	CONSTRAINT "ai_requests_input_tokens_positive" CHECK ("ai_requests"."input_tokens" >= 0),
	CONSTRAINT "ai_requests_output_tokens_positive" CHECK ("ai_requests"."output_tokens" >= 0),
	CONSTRAINT "ai_requests_cost_positive" CHECK ("ai_requests"."cost_usd_micros" >= 0),
	CONSTRAINT "ai_requests_query_length_range" CHECK ("ai_requests"."query_length" BETWEEN 3 AND 200),
	CONSTRAINT "ai_requests_model_needs_call" CHECK ("ai_requests"."attempts" > 0 OR "ai_requests"."model" IS NULL),
	CONSTRAINT "ai_requests_attempts_match_outcome" CHECK (("ai_requests"."outcome" IN ('circuit_open', 'budget_exceeded', 'not_configured')) = ("ai_requests"."attempts" = 0))
);
--> statement-breakpoint
CREATE INDEX "ai_requests_created_at_idx" ON "ai_requests" USING btree ("created_at");