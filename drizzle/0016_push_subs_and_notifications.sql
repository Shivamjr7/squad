-- M30 — replace users.push_subscription jsonb with a per-device table,
-- and add the notifications feed table.

CREATE TYPE "public"."notification_type" AS ENUM('vote_in', 'plan_created', 'plan_reminder');

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "device_hint" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone
);

DO $$ BEGIN
  ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_unique"
  ON "push_subscriptions" USING btree ("endpoint");

CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx"
  ON "push_subscriptions" USING btree ("user_id");

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "type" "notification_type" NOT NULL,
  "payload" jsonb,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "notifications_user_created_idx"
  ON "notifications" USING btree ("user_id", "created_at");

-- Drop the M26 column. There is no data migration: M26 only stored the
-- subscription opaquely and never fanned anything out, so users will be
-- prompted to re-subscribe after this lands.
ALTER TABLE "users" DROP COLUMN IF EXISTS "push_subscription";
