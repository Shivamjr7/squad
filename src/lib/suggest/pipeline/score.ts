// Stage 5 — scoring. Deterministic linear-weighted sum across 7 components.
// Every formula here mirrors 07-ranking-engine.md so the SPECs remain the
// authoritative reference for behavior. The function is pure: same inputs +
// same weights → identical breakdown.

import type {
  Activity,
  PriceTier,
  ScoreBreakdown,
  SuggestionContext,
  WeatherSnapshot,
} from "@/lib/suggest/types";
import type { Weights } from "@/lib/suggest/weights";
import { effectiveCentroid } from "./normalize";
import { hoursOverlapMinutes, windowDurationMinutes } from "./hours";

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Maps the [-1, 1] affinity scale into (0, 1) gently. The factor 3 makes
 *  ±1 land near 0.95 / 0.05 while keeping 0 → 0.5. */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-3 * x));
}

const PRICE_INDEX: Record<PriceTier, number> = {
  $: 1,
  $$: 2,
  $$$: 3,
  $$$$: 4,
};

// ─── Individual components ──────────────────────────────────────────────

function distanceScore(a: Activity, ctx: SuggestionContext): number {
  if (effectiveCentroid(ctx) === null) return 0.5;
  if (a.distanceMeters === undefined) return 0.5;
  return clamp01(1 - a.distanceMeters / (ctx.distanceKmCap * 1000));
}

function preferenceScore(a: Activity, ctx: SuggestionContext): number {
  const profile = ctx.groupPreferences;
  const categoryAff = profile.categoryAffinity[a.category];
  // Sigmoid is centered at 0.5; subtract to recenter at 0 so the offsets
  // around the 0.5 baseline are signed.
  const catTerm = categoryAff === undefined ? 0 : sigmoid(categoryAff) - 0.5;

  const cuisineKeys = Object.keys(profile.cuisineAffinity);
  let cuisineTerm = 0;
  if (cuisineKeys.length > 0 && a.tags?.length) {
    const matches: number[] = [];
    for (const t of a.tags) {
      const aff = profile.cuisineAffinity[t];
      if (aff !== undefined) matches.push(sigmoid(aff) - 0.5);
    }
    if (matches.length) {
      cuisineTerm = matches.reduce((s, n) => s + n, 0) / matches.length;
    }
  }

  return clamp01(0.5 + 0.5 * catTerm + 0.5 * cuisineTerm);
}

function weatherAcceptable(w: WeatherSnapshot): boolean {
  if (w.precipitationMm >= 1) return false;
  if (w.tempC < 10 || w.tempC > 35) return false;
  return true;
}

function weatherScore(a: Activity, ctx: SuggestionContext): number {
  if (!ctx.weather) {
    // Per spec — no weather signal → neutral defaults per sensitivity.
    if (a.weatherSensitivity === "indoor") return 0.7;
    if (a.weatherSensitivity === "outdoor") return 0.5;
    return 0.6;
  }
  const ok = weatherAcceptable(ctx.weather);
  if (a.weatherSensitivity === "outdoor") return ok ? 1.0 : 0.1;
  if (a.weatherSensitivity === "indoor") return ok ? 0.7 : 1.0;
  return 0.6;
}

function recencyScore(a: Activity, ctx: SuggestionContext): number {
  const recents = ctx.groupPreferences.recentVenueLabels;
  if (recents.length === 0) return 1.0;
  const aName = a.name.toLowerCase();
  const match = recents.find((r) => r.label.toLowerCase() === aName);
  if (!match) return 1.0;
  const lastUsed = new Date(match.lastUsedAt).getTime();
  if (!Number.isFinite(lastUsed)) return 1.0;
  const weeksSince = (Date.now() - lastUsed) / (7 * 24 * 60 * 60_000);
  return clamp01(weeksSince / 6);
}

function budgetScore(a: Activity, ctx: SuggestionContext): number {
  if (!ctx.budgetTier) return 1.0;
  if (!a.priceTier) return 0.7;
  const delta = Math.abs(PRICE_INDEX[a.priceTier] - PRICE_INDEX[ctx.budgetTier]);
  return Math.max(0, 1 - 0.4 * delta);
}

function hoursScore(a: Activity, ctx: SuggestionContext): number {
  if (ctx.timeWindow.isApproximate) return 1.0;
  if (!a.openingHours) return 0.7;
  const overlap = hoursOverlapMinutes(a.openingHours, ctx.timeWindow);
  const windowMin = Math.max(60, windowDurationMinutes(ctx.timeWindow));
  return clamp01(overlap / windowMin);
}

function popularityScore(a: Activity): number {
  if (!a.rating) return 0.5;
  // log10(1 + count) / 4: ~0.25 at 10 reviews, 0.5 at 100, 0.75 at 1k, 1.0 at 10k.
  const countFactor = clamp01(Math.log10(1 + a.rating.count) / 4);
  const scoreFactor = a.rating.score / 5;
  return clamp01(countFactor * scoreFactor);
}

// ─── Combined ───────────────────────────────────────────────────────────

export function scoreActivity(
  activity: Activity,
  ctx: SuggestionContext,
  weights: Weights,
): { score: number; breakdown: ScoreBreakdown } {
  const distance = distanceScore(activity, ctx);
  const preference = preferenceScore(activity, ctx);
  const weather = weatherScore(activity, ctx);
  const recency = recencyScore(activity, ctx);
  const budget = budgetScore(activity, ctx);
  const hours = hoursScore(activity, ctx);
  const popularity = popularityScore(activity);

  const raw =
    weights.distance * distance +
    weights.preference * preference +
    weights.weather * weather +
    weights.recency * recency +
    weights.budget * budget +
    weights.hours * hours +
    weights.popularity * popularity;

  return {
    score: clamp01(raw),
    breakdown: {
      distance,
      preference,
      weather,
      recency,
      budget,
      hours,
      popularity,
      raw,
    },
  };
}

// Exported for unit testing only — not part of the pipeline contract.
export const __internals = {
  clamp01,
  sigmoid,
  distanceScore,
  preferenceScore,
  weatherScore,
  recencyScore,
  budgetScore,
  hoursScore,
  popularityScore,
};
