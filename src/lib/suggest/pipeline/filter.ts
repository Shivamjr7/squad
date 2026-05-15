// Stage 4 — hard filters. Soft preferences (budget, weather, recency) are
// expressed as score penalties, not exclusions, so they live in score.ts.
// Per 06-recommendation-pipeline.md:
//   - distance ≤ cap  (skip if no centroid)
//   - category ∈ ctx.categories
//   - opening hours intersect window (skip if isApproximate)
//   - hardExclusions (v2-shaped but enforced if present)
//   - excludeIds final pass
//   - per-category rating + review-count threshold (quality.ts)
//
// The quality threshold is the lever that prevents low-rated nearby places
// from beating famous places further away. Activities without rating data
// (Eventbrite, low-coverage areas) pass through; rank.ts already has a
// threshold-fallback path that surfaces top-3 by raw score when everything
// is below the soft bar, so this filter cannot starve the result set.

import type { Activity, SuggestionContext } from "@/lib/suggest/types";
import { loadQualityThresholds, meetsQuality } from "@/lib/suggest/quality";
import { hoursOverlapMinutes } from "./hours";
import { effectiveCentroid } from "./normalize";

export function filter(
  activities: Activity[],
  ctx: SuggestionContext,
): Activity[] {
  const hasCentroid = effectiveCentroid(ctx) !== null;
  const distanceCapMeters = ctx.distanceKmCap * 1000;
  const excluded = new Set(ctx.excludeIds);
  const allowedCategories = new Set(ctx.categories);
  const hardExclusions = new Set(ctx.groupPreferences.hardExclusions ?? []);
  const qualityThresholds = loadQualityThresholds();

  return activities.filter((a) => {
    if (excluded.has(a.id)) return false;
    if (!allowedCategories.has(a.category)) return false;
    if (hardExclusions.has(a.category)) return false;
    if (a.tags && a.tags.some((t) => hardExclusions.has(t))) return false;

    if (
      hasCentroid &&
      a.distanceMeters !== undefined &&
      a.distanceMeters > distanceCapMeters
    ) {
      return false;
    }

    // Opening hours: only enforce on precise plans where the venue tells us
    // its hours. Approximate plans and venues with unknown hours are
    // tolerated and let scoring weigh in.
    if (!ctx.timeWindow.isApproximate && a.openingHours) {
      if (hoursOverlapMinutes(a.openingHours, ctx.timeWindow) === 0) {
        return false;
      }
    }

    if (!meetsQuality(a, qualityThresholds)) return false;

    return true;
  });
}
