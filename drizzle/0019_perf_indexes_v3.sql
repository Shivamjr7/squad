-- Additional performance indexes for query optimization

-- Plans: Fast lookup by circle and date range
CREATE INDEX IF NOT EXISTS "plans_circle_starts_idx" ON "plans" ("circle_id", "starts_at", "status");

-- Plans: Fast lookup by creator
CREATE INDEX IF NOT EXISTS "plans_created_by_circle_idx" ON "plans" ("created_by", "circle_id", "created_at");

-- Votes: Fast activity queries
CREATE INDEX IF NOT EXISTS "votes_plan_user_date_idx" ON "votes" ("plan_id", "user_id", "voted_at");

-- Votes: Fast per-user queries
CREATE INDEX IF NOT EXISTS "votes_user_date_idx" ON "votes" ("user_id", "voted_at");

-- Plan recipients: Fast visibility filtering  
CREATE INDEX IF NOT EXISTS "plan_recipients_plan_user_idx" ON "plan_recipients" ("plan_id", "user_id");

-- Memberships: Fast member lists
CREATE INDEX IF NOT EXISTS "memberships_circle_joined_idx" ON "memberships" ("circle_id", "joined_at");

-- Notifications: Fast unread queries
CREATE INDEX IF NOT EXISTS "notifications_user_read_idx" ON "notifications" ("user_id", "read_at");
