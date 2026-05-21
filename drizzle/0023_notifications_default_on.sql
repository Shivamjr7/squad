-- M31 — per-user global notification mute.
--   Defaults TRUE so new accounts are opted in at the model level
--   (NOTIFICATIONS_PLAN.md §1 principle 2). The OS permission decision is
--   the only step the user actively makes; this column is what /you →
--   Manage devices → "Mute all notifications" flips. resolvePlanAudience
--   filters out users where this is FALSE before any push dispatch.
ALTER TABLE "users" ADD COLUMN "notifications_enabled" boolean DEFAULT true NOT NULL;