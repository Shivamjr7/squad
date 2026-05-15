// Per-category quality thresholds. The pipeline drops Activities whose
// rating or review count is below the threshold for their category — this
// is the lever that surfaces "famous" places rather than "the closest
// hole-in-the-wall."
//
// Thresholds are tuned per-category because each category has different
// review-volume norms:
//   - Restaurants accumulate thousands of reviews; require both quality
//     AND volume to be considered well-known.
//   - Cafes can be famous with just a few hundred reviews; lower the count
//     bar but keep the rating bar high.
//   - Parks and sports facilities (outdoor) often have moderate review
//     counts even when popular — relax both bars.
//   - Movies / events have no Google-style review count → skip the filter
//     for these categories entirely.
//
// Override via env: SUGGEST_QUALITY_THRESHOLDS_JSON = '{"cafe":{"minRating":4.2,"minReviews":50}}'
// Partial overrides merge with defaults — set only the categories you want
// to change.

import { z } from "zod";
import type { ActivityCategory } from "./types";

export type QualityThreshold = {
  /** Minimum rating.score on a 0..5 scale. */
  minRating: number;
  /** Minimum rating.count. */
  minReviews: number;
};

/** null = no filter applied (movies/events). */
export type CategoryThresholds = Partial<
  Record<ActivityCategory, QualityThreshold | null>
>;

// Defaults tuned for "famous but inclusive of small popular spots."
export const DEFAULT_QUALITY_THRESHOLDS: CategoryThresholds = {
  restaurant: { minRating: 3.7, minReviews: 100 },
  cafe: { minRating: 4.0, minReviews: 30 },
  indoor: { minRating: 3.8, minReviews: 50 },
  outdoor: { minRating: 3.8, minReviews: 30 },
  short_trip: { minRating: 4.0, minReviews: 100 },
  // No rating filter — TMDB rating is on a different scale and Eventbrite
  // doesn't ship ratings at all. Quality for these comes from the provider's
  // own ranking (now_playing / sorted by date).
  movie: null,
  event: null,
};

const thresholdSchema = z
  .object({
    minRating: z.number().min(0).max(5),
    minReviews: z.number().int().min(0),
  })
  .nullable();

const overrideSchema = z.object({
  restaurant: thresholdSchema.optional(),
  cafe: thresholdSchema.optional(),
  movie: thresholdSchema.optional(),
  event: thresholdSchema.optional(),
  indoor: thresholdSchema.optional(),
  outdoor: thresholdSchema.optional(),
  short_trip: thresholdSchema.optional(),
});

/**
 * Returns the active thresholds map. Reads
 * `SUGGEST_QUALITY_THRESHOLDS_JSON` on every call so an env change is
 * picked up by the next request (no restart). Mirrors loadWeights().
 *
 * Failure modes silently fall back to DEFAULT_QUALITY_THRESHOLDS — a bad
 * env must never break the pipeline.
 */
export function loadQualityThresholds(): CategoryThresholds {
  const raw = process.env.SUGGEST_QUALITY_THRESHOLDS_JSON;
  if (!raw) return DEFAULT_QUALITY_THRESHOLDS;
  try {
    const parsed = overrideSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_QUALITY_THRESHOLDS;
    // Merge: env override wins per-category; everything else inherits the
    // default. Explicit null in env disables filtering for that category.
    return { ...DEFAULT_QUALITY_THRESHOLDS, ...parsed.data };
  } catch {
    return DEFAULT_QUALITY_THRESHOLDS;
  }
}

/**
 * Returns true if the activity meets the quality bar for its category.
 * Activities without rating data pass through — providers like Eventbrite
 * never populate ratings and we don't want to drop their results en masse.
 * The popularity score (score.ts) handles the soft penalty for these.
 */
export function meetsQuality(
  activity: { category: ActivityCategory; rating?: { score: number; count: number } },
  thresholds: CategoryThresholds,
): boolean {
  const t = thresholds[activity.category];
  if (t === null || t === undefined) return true; // no filter for this category
  if (!activity.rating) return true; // no rating data → can't reject on quality
  if (activity.rating.score < t.minRating) return false;
  if (activity.rating.count < t.minReviews) return false;
  return true;
}
