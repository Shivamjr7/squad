-- Add index on memberships.circleId to optimize member count queries
CREATE INDEX IF NOT EXISTS "memberships_circle_id_idx" ON "memberships" ("circle_id");

-- Add index on votes.planId to optimize vote-plan joins in activity queries
CREATE INDEX IF NOT EXISTS "votes_plan_id_idx" ON "votes" ("plan_id");
