// Stage 6 — rank. Sort, tie-break, diversity cap, threshold fallback. Pure
// function over the score outputs. Determinism is load-bearing — the log
// row stored in S5+ replays bit-identical results from the same inputs.
//
// S10 — Strategy seam. The pipeline calls `runRankStrategy()` instead of
// `rank()` directly. The default `heuristicRankStrategy` preserves the v1
// ordering exactly; a v2 LLM-backed rank strategy can register itself the
// same way the providers do and replace the heuristic without touching the
// orchestrator.

import type {
  Activity,
  ActivityCategory,
  Confidence,
  PriceTier,
  ScoreBreakdown,
} from "@/lib/suggest/types";

/** Below this, candidates are dropped unless the pool is empty (in which
 *  case we fall back to top-3 by raw, marked low confidence). */
const SCORE_THRESHOLD = 0.35;

/** Two scores within this window are considered tied → tie-break runs. */
const TIE_EPSILON = 0.005;

/** Provider tie-break order from 07-ranking-engine.md: movies/events
 *  outrank generic places when scores tie. */
const PROVIDER_PRIORITY: Record<string, number> = {
  tmdb: 0,
  eventbrite: 1,
  google_places: 2,
};

const PRICE_INDEX: Record<PriceTier, number> = {
  $: 1,
  $$: 2,
  $$$: 3,
  $$$$: 4,
};

export type Scored = {
  activity: Activity;
  score: number;
  breakdown: ScoreBreakdown;
};

export type RankOutput = {
  results: Scored[];
  /** True when every candidate was below SCORE_THRESHOLD and we backfilled
   *  from the raw-sorted top. UI/explain can show a "low-confidence picks"
   *  hint when this is set. */
  lowConfidenceFallback: boolean;
};

// ─── Strategy interface + registry ──────────────────────────────────────

export interface RankStrategy {
  readonly name: string;
  /**
   * Takes the scored candidate list and returns the final ranked slice +
   * confidence fallback flag. Allowed to return a Promise so an LLM-backed
   * re-ranker can await an API call — the pipeline always awaits.
   */
  rank(scored: Scored[], limit: number): RankOutput | Promise<RankOutput>;
}

let activeStrategy: RankStrategy | null = null;

export function registerRankStrategy(strategy: RankStrategy): void {
  activeStrategy = strategy;
}

export function getRankStrategy(): RankStrategy {
  return activeStrategy ?? heuristicRankStrategy;
}

/** Test-only override; throws outside NODE_ENV=test. */
export function setRankStrategy(strategy: RankStrategy | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("setRankStrategy() is test-only.");
  }
  activeStrategy = strategy;
}

/**
 * Pipeline-facing facade. Awaits the active strategy so both sync
 * (heuristic) and async (LLM) implementations share one call site.
 */
export async function runRankStrategy(
  scored: Scored[],
  limit: number,
): Promise<RankOutput> {
  return getRankStrategy().rank(scored, limit);
}

/**
 * Default heuristic ranker. Synchronous, deterministic. Exported for
 * direct unit-testing — the pipeline goes through `runRankStrategy()`
 * instead so a registered alternate can intercept.
 */
export function rank(scored: Scored[], limit: number): RankOutput {
  if (scored.length === 0) {
    return { results: [], lowConfidenceFallback: false };
  }

  // Deterministic sort by score desc, then tie-break.
  const sorted = [...scored].sort((a, b) => {
    if (Math.abs(a.score - b.score) > TIE_EPSILON) return b.score - a.score;
    return tieBreak(a.activity, b.activity);
  });

  // Threshold pool — or fall back to top-3 by raw if it empties.
  let pool = sorted.filter((s) => s.score >= SCORE_THRESHOLD);
  let lowConfidenceFallback = false;
  if (pool.length === 0) {
    pool = sorted.slice(0, Math.min(3, sorted.length));
    lowConfidenceFallback = true;
  }

  // Diversity cap = ceil(limit / 2). Excess push down, not out, so we
  // backfill from overflow once primary slots are spoken for.
  const perCategoryCap = Math.ceil(limit / 2);
  const counts = new Map<ActivityCategory, number>();
  const primary: Scored[] = [];
  const overflow: Scored[] = [];

  for (const s of pool) {
    const seen = counts.get(s.activity.category) ?? 0;
    if (seen < perCategoryCap) {
      primary.push(s);
      counts.set(s.activity.category, seen + 1);
    } else {
      overflow.push(s);
    }
    if (primary.length >= limit) break;
  }

  const results = primary.slice(0, limit);
  if (results.length < limit && overflow.length > 0) {
    results.push(...overflow.slice(0, limit - results.length));
  }

  return { results, lowConfidenceFallback };
}

function tieBreak(a: Activity, b: Activity): number {
  // 1. Higher rating.score wins.
  const aRating = a.rating?.score ?? 0;
  const bRating = b.rating?.score ?? 0;
  if (aRating !== bRating) return bRating - aRating;

  // 2. Closer distance wins.
  const aDist = a.distanceMeters ?? Number.POSITIVE_INFINITY;
  const bDist = b.distanceMeters ?? Number.POSITIVE_INFINITY;
  if (aDist !== bDist) return aDist - bDist;

  // 3. Lower price wins (cheaper is friendlier to the squad).
  const aPrice = a.priceTier ? PRICE_INDEX[a.priceTier] : 5;
  const bPrice = b.priceTier ? PRICE_INDEX[b.priceTier] : 5;
  if (aPrice !== bPrice) return aPrice - bPrice;

  // 4. Provider order.
  const aProv = PROVIDER_PRIORITY[a.provider] ?? 99;
  const bProv = PROVIDER_PRIORITY[b.provider] ?? 99;
  if (aProv !== bProv) return aProv - bProv;

  // 5. Final lexicographic on id — guarantees total order.
  return a.id.localeCompare(b.id);
}

export function confidenceLabel(score: number): Confidence {
  if (score >= 0.75) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

// ─── Default strategy registration ──────────────────────────────────────

/**
 * Built-in heuristic strategy. Registered eagerly at module load so the
 * pipeline has a working default even if no one ever calls
 * `registerRankStrategy()`. A v2 LLM strategy can override by calling
 * `registerRankStrategy(llmStrategy)` at app boot.
 */
export const heuristicRankStrategy: RankStrategy = {
  name: "heuristic",
  rank,
};

registerRankStrategy(heuristicRankStrategy);

// Exported for tests only.
export const __internals = { tieBreak, SCORE_THRESHOLD, TIE_EPSILON };
