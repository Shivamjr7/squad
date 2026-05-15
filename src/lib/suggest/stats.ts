// S8 — Suggest Plan adoption metrics. Pure read-only aggregation over
// `suggestion_logs` + `suggestion_log_items` (S5/S7 writes). Backs the
// admin Suggestions tab at /c/[slug]/stats and the weekly Resend email.
//
// Spec: docs/specs/suggest-plan/11-observability.md §Metrics. Computations
// are intentionally per-circle (logs are tenant-scoped) and pulled in JS
// after a single indexed range fetch — volume per circle / 7d window is
// small (tens to low thousands of rows).

import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { suggestionLogItems, suggestionLogs } from "@/db/schema";
import type { Activity } from "@/lib/suggest/types";

// Spec 11-observability.md §Metrics — "low_conf_fallback = items with
// score < 350 (int)". `suggestion_log_items.score` is stored ×1000, so
// the same int threshold applies verbatim.
const LOW_CONFIDENCE_INT_SCORE = 350;

export type SuggestStats = {
  /** Logs in window. */
  totalLogs: number;
  /** Items surfaced across all logs in window (impressions). */
  impressions: number;
  outcomes: Record<"served" | "refreshed" | "empty" | "errored", number>;
  feedback: Record<"add" | "reject" | "refresh" | "won" | "cancelled", number>;
  /** Rates 0..1, null if denominator is 0. */
  acceptanceRate: number | null;
  rejectRate: number | null;
  refreshRate: number | null;
  wonRate: number | null;
  cancellationAfterAddRate: number | null;
  lowConfidenceFallbackRate: number | null;
  emptyRate: number | null;
  /** Top activity categories among surfaced items. */
  topCategories: Array<{ category: string; impressions: number; adds: number }>;
  /** Per-provider count of degraded entries across logs. */
  degradedByProvider: Array<{ provider: string; count: number }>;
  /** ISO window endpoints. */
  windowStart: string;
  windowEnd: string;
};

export async function getSuggestStats(args: {
  circleId: string;
  since: Date;
  /** Inclusive upper bound. Defaults to now. */
  until?: Date;
}): Promise<SuggestStats> {
  const until = args.until ?? new Date();
  const logs = await db
    .select({
      id: suggestionLogs.id,
      outcome: suggestionLogs.outcome,
      degraded: suggestionLogs.degraded,
    })
    .from(suggestionLogs)
    .where(
      and(
        eq(suggestionLogs.circleId, args.circleId),
        gte(suggestionLogs.generatedAt, args.since),
      ),
    );

  const outcomes: SuggestStats["outcomes"] = {
    served: 0,
    refreshed: 0,
    empty: 0,
    errored: 0,
  };

  const degradedCounts = new Map<string, number>();
  const logIds: string[] = [];
  for (const log of logs) {
    logIds.push(log.id);
    const key = (log.outcome as keyof typeof outcomes) ?? "served";
    if (key in outcomes) outcomes[key] += 1;
    if (Array.isArray(log.degraded)) {
      for (const entry of log.degraded as Array<{ provider?: string }>) {
        if (typeof entry.provider !== "string") continue;
        degradedCounts.set(
          entry.provider,
          (degradedCounts.get(entry.provider) ?? 0) + 1,
        );
      }
    }
  }

  const feedback: SuggestStats["feedback"] = {
    add: 0,
    reject: 0,
    refresh: 0,
    won: 0,
    cancelled: 0,
  };

  let impressions = 0;
  let lowConfidence = 0;
  const categoryCounts = new Map<
    string,
    { impressions: number; adds: number }
  >();

  if (logIds.length > 0) {
    const items = await db
      .select({
        feedback: suggestionLogItems.feedback,
        score: suggestionLogItems.score,
        activity: suggestionLogItems.activity,
      })
      .from(suggestionLogItems)
      .where(inArray(suggestionLogItems.logId, logIds));

    impressions = items.length;
    for (const item of items) {
      if (item.score < LOW_CONFIDENCE_INT_SCORE) lowConfidence += 1;
      const fb = item.feedback as keyof typeof feedback | null;
      if (fb && fb in feedback) feedback[fb] += 1;
      const cat = (item.activity as Activity | null)?.category;
      if (typeof cat === "string") {
        const slot = categoryCounts.get(cat) ?? { impressions: 0, adds: 0 };
        slot.impressions += 1;
        if (fb === "add") slot.adds += 1;
        categoryCounts.set(cat, slot);
      }
    }
  }

  const rate = (numer: number, denom: number): number | null =>
    denom === 0 ? null : numer / denom;

  const topCategories = Array.from(categoryCounts.entries())
    .map(([category, c]) => ({ category, ...c }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 5);

  const degradedByProvider = Array.from(degradedCounts.entries())
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalLogs: logs.length,
    impressions,
    outcomes,
    feedback,
    acceptanceRate: rate(feedback.add, impressions),
    rejectRate: rate(feedback.reject, impressions),
    refreshRate: rate(feedback.refresh, impressions),
    wonRate: rate(feedback.won, feedback.add),
    cancellationAfterAddRate: rate(feedback.cancelled, feedback.add),
    lowConfidenceFallbackRate: rate(lowConfidence, impressions),
    emptyRate: rate(outcomes.empty, logs.length),
    topCategories,
    degradedByProvider,
    windowStart: args.since.toISOString(),
    windowEnd: until.toISOString(),
  };
}
