ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'plan_conflict';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'plan_conflict_resolved';--> statement-breakpoint
CREATE TABLE "conflict_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"plan_a_id" uuid NOT NULL,
	"plan_b_id" uuid NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	CONSTRAINT "conflict_notifications_canonical_pair_check" CHECK ("conflict_notifications"."plan_a_id" < "conflict_notifications"."plan_b_id")
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "duration_minutes" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "conflict_notifications" ADD CONSTRAINT "conflict_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_notifications" ADD CONSTRAINT "conflict_notifications_plan_a_id_plans_id_fk" FOREIGN KEY ("plan_a_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_notifications" ADD CONSTRAINT "conflict_notifications_plan_b_id_plans_id_fk" FOREIGN KEY ("plan_b_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conflict_notifications_user_pair_unique" ON "conflict_notifications" USING btree ("user_id","plan_a_id","plan_b_id");--> statement-breakpoint
CREATE INDEX "idx_plans_starts_at_status" ON "plans" USING btree ("starts_at") WHERE "plans"."status" IN ('active', 'confirmed');--> statement-breakpoint
CREATE INDEX "idx_votes_user_status_in" ON "votes" USING btree ("user_id","status") WHERE "votes"."status" IN ('in', 'maybe');