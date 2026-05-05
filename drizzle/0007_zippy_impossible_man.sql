CREATE TYPE "public"."plan_time_mode" AS ENUM('exact', 'open');--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "time_mode" "plan_time_mode" DEFAULT 'exact' NOT NULL;