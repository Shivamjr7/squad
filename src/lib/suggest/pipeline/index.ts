// Pipeline orchestrator. Pure function — no DB writes, no analytics, no
// action-layer concerns. The action (S5) calls runPipeline, persists the
// returned RecommendationResult (using its already-generated ids), and
// hands the same shape back to the client.
//
// Flow mirrors docs/specs/suggest-plan/06-recommendation-pipeline.md:
//   gather → fetch → normalize → filter → score → rank → explain
// `log` is intentionally absent here; that's the action layer's job.

import { randomUUID } from "node:crypto";
import type {
  RankedResult,
  RecommendationResult,
  SuggestionContext,
} from "@/lib/suggest/types";
import { loadWeights } from "@/lib/suggest/weights";
import { fetchActivities } from "./fetch-activities";
import { normalize } from "./normalize";
import { filter } from "./filter";
import { scoreActivity } from "./score";
import { rank, confidenceLabel } from "./rank";
import { explain } from "./explain";

export type RunPipelineOptions = {
  /** Max RankedResult count returned. Default 5; client may request 1..10. */
  limit?: number;
};

export async function runPipeline(
  ctx: SuggestionContext,
  opts: RunPipelineOptions = {},
): Promise<RecommendationResult> {
  const limit = clampLimit(opts.limit ?? 5);
  const generatedAt = new Date().toISOString();
  const weights = loadWeights();

  // 1. Fetch (provider calls, parallel, isolated).
  const { activities, degraded } = await fetchActivities(ctx);

  // 2. Normalize (distance compute, dedup).
  const normalized = normalize(activities, ctx);

  // 3. Filter (hard rules only; soft = scoring penalty).
  const filtered = filter(normalized, ctx);

  // 4. Score every survivor.
  const scored = filtered.map((activity) => {
    const { score, breakdown } = scoreActivity(activity, ctx, weights);
    return { activity, score, breakdown };
  });

  // 5. Rank + diversity cap.
  const { results: ranked, lowConfidenceFallback } = rank(scored, limit);

  // 6. Explanations + assemble final shape. Ids are minted now and re-used
  //    by the action layer when it writes suggestion_log_items.
  const results: RankedResult[] = ranked.map((r) => {
    // When the threshold fell back, force the confidence label to `low`
    // even if the raw score happens to land above the medium cutoff —
    // the user-facing UI should reflect the fallback honestly.
    const confidence = lowConfidenceFallback
      ? "low"
      : confidenceLabel(r.score);
    return {
      id: randomUUID(),
      activity: r.activity,
      score: r.score,
      breakdown: r.breakdown,
      explanation: explain(r.activity, r.breakdown, ctx),
      confidence,
      provider: r.activity.provider,
    };
  });

  return {
    suggestionLogId: randomUUID(),
    generatedAt,
    results,
    degraded: degraded.length > 0 ? degraded : undefined,
  };
}

function clampLimit(n: number): number {
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, Math.floor(n)));
}

// Re-exports for convenient consumption by S5+ without deep imports.
export { gatherContext } from "./gather-context";
export type { GatherContextInput } from "./gather-context";
