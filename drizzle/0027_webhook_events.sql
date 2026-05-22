-- Webhook idempotency log. Svix's library already rejects payloads with a
-- timestamp outside ±5 minutes, but a replayed payload within that window
-- with a valid signature would still re-fire our DB writes. Storing the
-- svix-id lets us treat each event as exactly-once.
--
-- Cleanup: rows are vacuumed by the existing provider-cache cron (the
-- handler appends a DELETE for entries older than 24h — Svix's window is
-- 5min, so 24h is comfortable headroom).

CREATE TABLE IF NOT EXISTS webhook_events (
  svix_id TEXT PRIMARY KEY,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_events_received_idx
  ON webhook_events (received_at);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
