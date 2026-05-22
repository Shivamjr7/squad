-- Phase 2: complete the RLS lockdown started in 0024.
--
-- Phase 1 (0024) kept votes/comments/etc. readable by anon via permissive
-- SELECT policies so the existing postgres_changes Realtime subscriptions
-- kept working. With the broadcast rewrite (server.ts + the five hooks),
-- the browser no longer SELECTs these tables — it only listens on pub/sub
-- channels. We can now:
--
--   1. Drop the permissive read policies → default-deny is reached.
--   2. Remove the tables from the supabase_realtime publication → no
--      postgres_changes broadcasts even attempt to fan out. (Broadcast
--      channels don't depend on this publication.)
--
-- Drizzle (postgres role via DATABASE_URL) is unaffected; server-side
-- reads/writes still bypass RLS.

-- ─── Drop the read policies added in 0024 ─────────────────────────────
DROP POLICY IF EXISTS "realtime_read_votes" ON votes;
DROP POLICY IF EXISTS "realtime_read_comments" ON comments;
DROP POLICY IF EXISTS "realtime_read_plan_venues" ON plan_venues;
DROP POLICY IF EXISTS "realtime_read_plan_venue_votes" ON plan_venue_votes;
DROP POLICY IF EXISTS "realtime_read_plan_time_proposals" ON plan_time_proposals;
DROP POLICY IF EXISTS "realtime_read_plan_time_proposal_votes" ON plan_time_proposal_votes;
DROP POLICY IF EXISTS "realtime_read_time_slot_votes" ON time_slot_votes;

-- ─── Stop publishing row deltas to Realtime postgres_changes ──────────
-- Wrapped in DO blocks so the migration is idempotent (the publication
-- may already lack the table on re-runs in a fresh environment).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE votes;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE comments;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE plan_venues;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE plan_venue_votes;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE plan_time_proposals;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE plan_time_proposal_votes;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE time_slot_votes;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
