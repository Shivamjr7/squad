-- Security: enable RLS + default-deny on every table, plus an explicit
-- defense-in-depth REVOKE of write privileges from the anon and
-- authenticated roles.
--
-- Why now: until this migration, no table had RLS enabled. The browser
-- uses NEXT_PUBLIC_SUPABASE_ANON_KEY (public, in every page source) for
-- Realtime subscriptions. Without RLS, that key also unlocks PostgREST
-- SELECT * on every table — including users.email, plans.location,
-- push_subscriptions.endpoint, plan_recipients, invites, etc. This
-- migration closes that hole.
--
-- Server reads/writes are unaffected: Drizzle connects via DATABASE_URL
-- as the `postgres` role, which bypasses RLS. The only access paths this
-- changes are the public PostgREST + Realtime channels.
--
-- Hybrid approach (phase 1):
--   * Tables NOT in the supabase_realtime publication → default deny
--     (RLS enabled, no policies → anon and authenticated cannot SELECT).
--   * Tables IN the realtime publication retain a permissive SELECT
--     policy so the existing postgres_changes subscriptions keep
--     working without a rewrite. Phase 2 swaps them to broadcast.
--
-- The status-quo realtime exposure (votes, comments, vote-tally tables)
-- is documented in SECURITY_PLAN.md §Phase 2.

-- ─── Enable RLS on every table ──────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE circles ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE conflict_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_slot_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_venue_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_time_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_time_proposal_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE circle_preference_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE suggestion_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE suggestion_log_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_cache ENABLE ROW LEVEL SECURITY;

-- ─── Permissive SELECT policies for realtime-published tables ──────────
-- These keep the existing postgres_changes subscriptions working. Phase 2
-- replaces them with Supabase Broadcast and drops these policies.
CREATE POLICY "realtime_read_votes" ON votes
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "realtime_read_comments" ON comments
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "realtime_read_plan_venues" ON plan_venues
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "realtime_read_plan_venue_votes" ON plan_venue_votes
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "realtime_read_plan_time_proposals" ON plan_time_proposals
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "realtime_read_plan_time_proposal_votes" ON plan_time_proposal_votes
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "realtime_read_time_slot_votes" ON time_slot_votes
  FOR SELECT TO anon, authenticated USING (true);

-- ─── Defense in depth: deny writes to anon + authenticated ──────────────
-- All mutations go through server actions that use the `postgres` role
-- via DATABASE_URL. The anon and authenticated roles should never write
-- to the schema directly. RLS plus a missing INSERT/UPDATE/DELETE policy
-- already denies writes, but REVOKE makes the intent explicit and
-- protects against future "oops" policies that accidentally grant write
-- access.
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon, authenticated;
