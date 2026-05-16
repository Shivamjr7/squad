-- M31 — notifications revamp.
--   1. Extend notification_type enum with the three new kinds. Postgres
--      enums grow forward only, so existing rows + writers stay valid.
--   2. Add plans.leave_push_sent_at — gates the 45-min pre-leave push the
--      same way reminder_sent_at gated the old 1h reminder.

ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'plan_locked';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'plan_leave_soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'plan_cancelled';--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "leave_push_sent_at" timestamp with time zone;
