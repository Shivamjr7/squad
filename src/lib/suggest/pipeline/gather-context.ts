// Stage 1 — gather-context. Turns the loose API-shaped input into a fully-
// populated SuggestionContext. The action layer (S5) is responsible for any
// DB-backed prefetches (circle centroid, recipient set, preference signals);
// this file is pure, no I/O.
//
// Preferences are stubbed to a neutral profile here. When S6+ ships DB-
// backed `circle_preference_signals`, the action layer will fetch + pass
// `groupPreferences` in; otherwise this default kicks in and the pipeline
// scores everyone neutrally.

import type {
  ActivityCategory,
  GroupPreferenceProfile,
  SuggestionContext,
  TimeWindow,
  WeatherSnapshot,
} from "@/lib/suggest/types";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

// Per 06-recommendation-pipeline.md §gatherContext step 6.
const CATEGORY_DEFAULTS_KM: Record<ActivityCategory, number> = {
  restaurant: 3,
  cafe: 3,
  movie: 8,
  event: 8,
  indoor: 8,
  outdoor: 10,
  short_trip: 50,
};

// Per 03-functional-requirements.md "Supported categories" + planType
// mapping. `other` opens the full set; `play` excludes restaurant/cafe
// (those are for `eat`/`chai`).
const PLAN_TYPE_TO_CATEGORIES: Record<
  SuggestionContext["planType"],
  ActivityCategory[]
> = {
  eat: ["restaurant", "cafe"],
  play: ["indoor", "outdoor", "event"],
  chai: ["cafe"],
  "stay-in": ["indoor"],
  other: [
    "restaurant",
    "cafe",
    "movie",
    "event",
    "indoor",
    "outdoor",
    "short_trip",
  ],
};

export type GatherContextInput = {
  circleId: string;
  userId: string;
  planType: SuggestionContext["planType"];
  /** ISO. */
  startsAtUtc: string;
  /** ISO. Optional — defaults to startsAtUtc + 2h. */
  endsAtUtc?: string;
  isApproximate: boolean;
  timeZone: string;
  geo?: SuggestionContext["geo"];
  /** Pre-fetched from circles.home_lat/lng by the action layer. */
  circleCentroid?: SuggestionContext["circleCentroid"];
  distanceKmCap?: number;
  budgetTier?: SuggestionContext["budgetTier"];
  excludeIds?: string[];
  recipientUserIds?: string[];
  /** Stub seam for S9 weather provider. Null/undefined → neutral scoring. */
  weather?: WeatherSnapshot | null;
  /**
   * Optional pre-built preference profile (S6+ will hydrate from DB). Absent
   * → defaultPreferenceProfile().
   */
  groupPreferences?: GroupPreferenceProfile;
  requestNonce: string;
};

export function gatherContext(input: GatherContextInput): SuggestionContext {
  const categories = PLAN_TYPE_TO_CATEGORIES[input.planType];

  const startsAtUtc = new Date(input.startsAtUtc).toISOString();
  const endsAtUtc = input.endsAtUtc
    ? new Date(input.endsAtUtc).toISOString()
    : new Date(new Date(input.startsAtUtc).getTime() + TWO_HOURS_MS).toISOString();

  const timeWindow: TimeWindow = {
    startsAtUtc,
    endsAtUtc,
    isApproximate: input.isApproximate,
    timeZone: input.timeZone,
  };

  const distanceKmCap =
    input.distanceKmCap ??
    Math.max(...categories.map((c) => CATEGORY_DEFAULTS_KM[c]));

  const recipientUserIds = input.recipientUserIds ?? [];

  return {
    circleId: input.circleId,
    userId: input.userId,
    planType: input.planType,
    categories,
    timeWindow,
    geo: input.geo,
    circleCentroid: input.circleCentroid,
    distanceKmCap,
    budgetTier: input.budgetTier,
    excludeIds: input.excludeIds ?? [],
    recipientUserIds,
    weather: input.weather ?? undefined,
    groupPreferences:
      input.groupPreferences ??
      defaultPreferenceProfile(input.circleId, recipientUserIds),
    requestNonce: input.requestNonce,
  };
}

/**
 * Neutral profile — every affinity empty, no recent venues. Scoring treats
 * this as "no signal" and produces middle-of-the-road preference scores.
 * Acts as the bootstrap profile for circles that have never run a plan
 * before, and the fallback when S6+ hasn't populated the signals table.
 */
export function defaultPreferenceProfile(
  circleId: string,
  cohort: string[],
): GroupPreferenceProfile {
  return {
    circleId,
    cohort,
    cuisineAffinity: {},
    categoryAffinity: {},
    priceAffinity: {},
    recentVenueLabels: [],
    computedAt: new Date(0).toISOString(),
  };
}
