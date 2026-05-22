import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { ActionError } from "@/lib/actions/errors";

// Postgres-backed sliding-window rate limiter. One atomic UPSERT per
// `takeToken()` call — the increment-or-reset decision happens inside
// the SQL CASE, so concurrent requests can't both observe `count < limit`
// and both pass.
//
// Why not Redis: friend-group scale, no need for a separate dependency.
// The vacuum cron prunes stale rows daily.
//
// Why ActionError instead of just returning a boolean: server actions
// already throw ActionError on validation/auth failure, so the call
// site reads naturally as `await takeToken(...)` with no extra branching.

export type RateLimitOptions = {
  // Identity bucket. Usually the userId; for unauthenticated paths use
  // an IP hash or session id. Keep this stable per actor.
  key: string;
  // Logical action name — keeps actions in separate buckets so a comment
  // spam doesn't eat the user's vote budget.
  action: string;
  // Maximum allowed events per window.
  limit: number;
  // Window length in milliseconds. 60_000 = 1 minute, 3_600_000 = 1 hour.
  windowMs: number;
};

export async function takeToken(opts: RateLimitOptions): Promise<void> {
  const fullKey = `${opts.action}:${opts.key}`;
  // The CASE expression handles both branches of the sliding window:
  //   - If the existing window_start is older than `windowMs`, reset.
  //   - Otherwise, increment.
  // RETURNING the post-update count lets us decide deny/allow without a
  // second query.
  const result = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${fullKey}, NOW(), 1)
    ON CONFLICT (key) DO UPDATE
    SET
      count = CASE
        WHEN rate_limits.window_start < NOW() - (${opts.windowMs} * INTERVAL '1 millisecond')
          THEN 1
        ELSE rate_limits.count + 1
      END,
      window_start = CASE
        WHEN rate_limits.window_start < NOW() - (${opts.windowMs} * INTERVAL '1 millisecond')
          THEN NOW()
        ELSE rate_limits.window_start
      END
    RETURNING count
  `);

  // `db.execute` returns either `RowList<T[]>` (postgres-js) or a plain
  // array depending on driver. Normalize both shapes.
  const rows = (Array.isArray(result) ? result : (result as { rows?: { count: number }[] }).rows) ?? [];
  const count = Number(rows[0]?.count ?? 0);

  if (count > opts.limit) {
    throw new ActionError(
      "INVALID",
      "You're going a bit fast — try again in a minute.",
    );
  }
}

// ─── Predefined buckets (used by mutating server actions) ───────────────
// All windows are 1 hour. Limits chosen to be generous for a normal
// session but cap obvious abuse.

export const RATE = {
  vote: { limit: 60, windowMs: 3_600_000 }, // 60 votes/hour
  comment: { limit: 30, windowMs: 3_600_000 }, // 30 comments/hour
  createPlan: { limit: 10, windowMs: 3_600_000 }, // 10 plans/hour
  proposeTime: { limit: 20, windowMs: 3_600_000 }, // 20 time proposals/hour
  addVenue: { limit: 20, windowMs: 3_600_000 }, // 20 venue suggestions/hour
  pushSubscribe: { limit: 10, windowMs: 3_600_000 }, // 10 subscribes/hour
  placeSearch: { limit: 120, windowMs: 3_600_000 }, // 120 place searches/hour
} as const;
