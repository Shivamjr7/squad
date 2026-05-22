-- Phase 2 rate limiter table. One row per (action, identity) pair with a
-- sliding window counter. Atomic increment via a single ON CONFLICT
-- statement — no separate read/check/write race.
--
-- Scale: friend-group → small. We don't need Redis. Vacuumed daily by
-- the same cron that vacuums provider_cache (cron route updated to
-- delete stale rate_limit rows alongside cache rows).
--
-- The key column is unconstrained text so callers can shape it freely
-- (e.g. "vote:user_abc", "comment:user_xyz", "place_search:user_abc").

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  count INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS rate_limits_window_idx
  ON rate_limits (window_start);

-- RLS: this table never reaches the browser. Server actions (postgres
-- role) read/write directly. Enable RLS so the anon role can't poke.
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
