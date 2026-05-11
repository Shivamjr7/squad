-- Performance indexes for hot query paths. All additive, fully idempotent
-- via IF NOT EXISTS. No schema/data-model change — just covers seq scans on
-- columns that every tab/page filters on.

-- Home + my-plans + plan-detail: WHERE plans.circle_id = ?
CREATE INDEX IF NOT EXISTS "plans_circle_id_idx"
  ON "plans" USING btree ("circle_id");

-- Upcoming list ORDER BY plans.starts_at + the >= now() filter.
-- Composite (circle_id, starts_at) covers both the filter and the sort.
CREATE INDEX IF NOT EXISTS "plans_circle_starts_idx"
  ON "plans" USING btree ("circle_id", "starts_at");

-- My-plans count(comments) per plan; plan-detail comment thread.
CREATE INDEX IF NOT EXISTS "comments_plan_id_idx"
  ON "comments" USING btree ("plan_id");

-- Home featured/upcoming surfaces leading venue; plan-detail loads venue rows.
CREATE INDEX IF NOT EXISTS "plan_venues_plan_id_idx"
  ON "plan_venues" USING btree ("plan_id");

-- Plan-detail open-time heatmap.
CREATE INDEX IF NOT EXISTS "time_slots_plan_id_idx"
  ON "time_slots" USING btree ("plan_id");

-- Plan-detail counter-proposals + additions (kind filter).
CREATE INDEX IF NOT EXISTS "plan_time_proposals_plan_id_idx"
  ON "plan_time_proposals" USING btree ("plan_id");

-- Visibility filter on every home/my-plans page: NOT EXISTS / EXISTS subquery
-- by plan_id. The unique (plan_id,user_id) covers leading-column lookups,
-- but PG can use this lighter btree for the EXISTS path.
CREATE INDEX IF NOT EXISTS "plan_recipients_plan_id_idx"
  ON "plan_recipients" USING btree ("plan_id");

-- Squad Pulse activity query: WHERE votes.user_id IN (...) GROUP BY user_id.
-- votes_plan_user_unique leads on plan_id so doesn't help this access path.
CREATE INDEX IF NOT EXISTS "votes_user_id_idx"
  ON "votes" USING btree ("user_id");
