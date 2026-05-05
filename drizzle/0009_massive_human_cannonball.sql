CREATE TABLE "plan_venue_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"voted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"label" text NOT NULL,
	"suggested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_venue_votes" ADD CONSTRAINT "plan_venue_votes_venue_id_plan_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."plan_venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_venue_votes" ADD CONSTRAINT "plan_venue_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_venues" ADD CONSTRAINT "plan_venues_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_venues" ADD CONSTRAINT "plan_venues_suggested_by_users_id_fk" FOREIGN KEY ("suggested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_venue_votes_venue_user_unique" ON "plan_venue_votes" USING btree ("venue_id","user_id");--> statement-breakpoint
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE plan_venue_votes;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE plan_venues;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;