ALTER TABLE "users" ADD COLUMN "has_set_display_name" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "users" SET "has_set_display_name" = true WHERE "display_name" NOT LIKE '%@%';