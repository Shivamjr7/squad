CREATE TYPE "public"."plan_event_kind" AS ENUM('created', 'voted', 'proposed_time', 'proposed_venue', 'added_member', 'locked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."proposal_kind" AS ENUM('replacement', 'addition');--> statement-breakpoint
CREATE TABLE "plan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"user_id" text,
	"kind" "plan_event_kind" NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_time_proposals" ADD COLUMN "kind" "proposal_kind" DEFAULT 'replacement' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_events" ADD CONSTRAINT "plan_events_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_events" ADD CONSTRAINT "plan_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_events_plan_created_at_idx" ON "plan_events" USING btree ("plan_id","created_at");