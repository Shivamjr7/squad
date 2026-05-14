// Suggest Plan — ranking weights. See docs/specs/suggest-plan/07-ranking-engine.md.
// Default weights sum to 1.0; live override via SUGGEST_WEIGHTS_JSON env so we
// can A/B without redeploying.

import { z } from "zod";

export const WEIGHT_KEYS = [
  "distance",
  "preference",
  "weather",
  "recency",
  "budget",
  "hours",
  "popularity",
] as const;
export type WeightKey = (typeof WEIGHT_KEYS)[number];

export type Weights = Record<WeightKey, number>;

export const DEFAULT_WEIGHTS: Weights = {
  distance: 0.2,
  preference: 0.25,
  weather: 0.1,
  recency: 0.1,
  budget: 0.1,
  hours: 0.15,
  popularity: 0.1,
};

const weightsSchema = z.object({
  distance: z.number().min(0).max(1),
  preference: z.number().min(0).max(1),
  weather: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  budget: z.number().min(0).max(1),
  hours: z.number().min(0).max(1),
  popularity: z.number().min(0).max(1),
});

/**
 * Returns the active ranking weights. Reads SUGGEST_WEIGHTS_JSON on every
 * call so an env change is picked up by the next request (no restart). Any
 * parse / validation failure silently falls back to DEFAULT_WEIGHTS — a bad
 * env must never break the pipeline. We do NOT enforce sum=1 here; the
 * ranker normalizes implicitly via clamp01(raw).
 */
export function loadWeights(): Weights {
  const raw = process.env.SUGGEST_WEIGHTS_JSON;
  if (!raw) return DEFAULT_WEIGHTS;
  try {
    const parsed = weightsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Invalid JSON — fall through.
  }
  return DEFAULT_WEIGHTS;
}
