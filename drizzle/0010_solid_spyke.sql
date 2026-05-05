CREATE TABLE "plan_time_proposal_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"voted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_time_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"proposed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "lock_threshold" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_time_proposal_votes" ADD CONSTRAINT "plan_time_proposal_votes_proposal_id_plan_time_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."plan_time_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_time_proposal_votes" ADD CONSTRAINT "plan_time_proposal_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_time_proposals" ADD CONSTRAINT "plan_time_proposals_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_time_proposals" ADD CONSTRAINT "plan_time_proposals_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_time_proposal_votes_proposal_user_unique" ON "plan_time_proposal_votes" USING btree ("proposal_id","user_id");--> statement-breakpoint
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE plan_time_proposals;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE plan_time_proposal_votes;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;