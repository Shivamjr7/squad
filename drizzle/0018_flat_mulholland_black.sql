CREATE TABLE "circle_preference_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"signal_kind" text NOT NULL,
	"signal_key" text NOT NULL,
	"weight" integer NOT NULL,
	"cohort" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggestion_log_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"log_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"activity" jsonb NOT NULL,
	"breakdown" jsonb NOT NULL,
	"score" integer NOT NULL,
	"feedback" text,
	"feedback_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "suggestion_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"circle_id" uuid NOT NULL,
	"user_id" text,
	"plan_id" uuid,
	"request_nonce" uuid NOT NULL,
	"context" jsonb NOT NULL,
	"weights" jsonb NOT NULL,
	"degraded" jsonb,
	"outcome" text DEFAULT 'served' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "circles" ADD COLUMN "home_location_text" text;--> statement-breakpoint
ALTER TABLE "circles" ADD COLUMN "home_lat" double precision;--> statement-breakpoint
ALTER TABLE "circles" ADD COLUMN "home_lng" double precision;--> statement-breakpoint
ALTER TABLE "circles" ADD COLUMN "home_radius_km" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_venues" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_venues" ADD COLUMN "suggestion_item_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_venues" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "plan_venues" ADD COLUMN "external_url" text;--> statement-breakpoint
ALTER TABLE "plan_venues" ADD COLUMN "external_geo" jsonb;--> statement-breakpoint
ALTER TABLE "circle_preference_signals" ADD CONSTRAINT "circle_preference_signals_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_log_items" ADD CONSTRAINT "suggestion_log_items_log_id_suggestion_logs_id_fk" FOREIGN KEY ("log_id") REFERENCES "public"."suggestion_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_logs" ADD CONSTRAINT "suggestion_logs_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_logs" ADD CONSTRAINT "suggestion_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_logs" ADD CONSTRAINT "suggestion_logs_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "circle_pref_kind_key_idx" ON "circle_preference_signals" USING btree ("circle_id","signal_kind","signal_key");--> statement-breakpoint
CREATE INDEX "provider_cache_expires_idx" ON "provider_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "suggestion_log_items_log_rank_idx" ON "suggestion_log_items" USING btree ("log_id","rank");--> statement-breakpoint
CREATE INDEX "suggestion_log_items_feedback_idx" ON "suggestion_log_items" USING btree ("feedback");--> statement-breakpoint
CREATE UNIQUE INDEX "suggestion_logs_user_nonce_unique" ON "suggestion_logs" USING btree ("user_id","request_nonce");--> statement-breakpoint
CREATE INDEX "suggestion_logs_circle_created_idx" ON "suggestion_logs" USING btree ("circle_id","generated_at");--> statement-breakpoint
ALTER TABLE "plan_venues" ADD CONSTRAINT "plan_venues_suggestion_item_id_suggestion_log_items_id_fk" FOREIGN KEY ("suggestion_item_id") REFERENCES "public"."suggestion_log_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The 8 indexes below were physically created by drizzle/0017_perf_indexes.sql,
-- but main shipped 0017 with a stale snapshot that didn't capture them, so
-- drizzle-kit re-emits them here. IF NOT EXISTS makes the migration idempotent
-- in environments that already ran 0017 (prod/staging). Drop these lines and
-- the comment once main's 0017 snapshot is repaired.
CREATE INDEX IF NOT EXISTS "comments_plan_id_idx" ON "comments" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_recipients_plan_id_idx" ON "plan_recipients" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_time_proposals_plan_id_idx" ON "plan_time_proposals" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_venues_plan_id_idx" ON "plan_venues" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plans_circle_id_idx" ON "plans" USING btree ("circle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plans_circle_starts_idx" ON "plans" USING btree ("circle_id","starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_slots_plan_id_idx" ON "time_slots" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "votes_user_id_idx" ON "votes" USING btree ("user_id");