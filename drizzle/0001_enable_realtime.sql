-- Enable Supabase Realtime broadcasts on votes and comments so the client
-- can subscribe to INSERT/UPDATE/DELETE events. Required for live vote tally
-- (M5) and live comments (M6). Idempotent: ALTER PUBLICATION ... ADD TABLE
-- errors if the table is already a member, so we wrap in a DO block to skip
-- silently on re-runs.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE votes;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE comments;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
