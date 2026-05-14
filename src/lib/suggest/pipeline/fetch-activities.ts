// Stage 2 — fetch-activities. Dispatches to whatever providers the S2 registry
// has registered, in parallel, with per-call timeout + cache-through from S3.
// Provider failures are isolated to entries in `degraded[]`; the pipeline
// never throws because one upstream blipped.

import type {
  Activity,
  ActivityCategory,
  ProviderSearchInput,
  SuggestionContext,
  SuggestionProvider,
} from "@/lib/suggest/types";
import { getProvider } from "@/lib/suggest/providers/registry";
import { cacheThrough } from "@/lib/suggest/cache/provider-cache";
import { effectiveCentroid } from "./normalize";

/** Per 08-provider-architecture.md — 3 s hard, on top of the provider's
 *  internal 1.5 s soft. */
const HARD_TIMEOUT_MS = 3_000;
/** Soft cap on candidates per provider; ranker trims to user's `limit`
 *  later. Overprovisioning here lets the diversity rule actually have
 *  choices to balance. */
const PROVIDER_FETCH_LIMIT = 20;

export type FetchResult = {
  activities: Activity[];
  degraded: Array<{ provider: string; reason: string }>;
};

export async function fetchActivities(
  ctx: SuggestionContext,
): Promise<FetchResult> {
  const centroid = effectiveCentroid(ctx);
  const degraded: Array<{ provider: string; reason: string }> = [];

  // No usable centroid → cannot dispatch (Places needs a location). Caller
  // will see empty results; that's the documented "category-only" path.
  if (!centroid) {
    for (const cat of ctx.categories) {
      degraded.push({ provider: cat, reason: "no_centroid" });
    }
    return { activities: [], degraded };
  }

  // Group categories by provider so one provider covering 5 categories
  // turns into ONE network call, not five.
  const byProvider = new Map<
    string,
    { provider: SuggestionProvider; categories: ActivityCategory[] }
  >();
  for (const cat of ctx.categories) {
    const provider = getProvider(cat);
    if (!provider) {
      degraded.push({ provider: cat, reason: "no_provider" });
      continue;
    }
    const existing = byProvider.get(provider.name);
    if (existing) {
      existing.categories.push(cat);
    } else {
      byProvider.set(provider.name, { provider, categories: [cat] });
    }
  }

  const radiusMeters = Math.round(ctx.distanceKmCap * 1000);

  // Promise.all on individually-isolated tasks: each task swallows its own
  // failure into `degraded` and returns []. The outer await never rejects.
  const tasks = Array.from(byProvider.values()).map(
    async ({ provider, categories }) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), HARD_TIMEOUT_MS);
      const input: ProviderSearchInput = {
        categories,
        centroid,
        radiusMeters,
        timeWindow: ctx.timeWindow,
        budgetTier: ctx.budgetTier,
        excludeIds: ctx.excludeIds,
        limit: PROVIDER_FETCH_LIMIT,
      };
      try {
        return await cacheThrough(provider, input, ac.signal);
      } catch (err) {
        degraded.push({
          provider: provider.name,
          reason: errorReason(err),
        });
        return [];
      } finally {
        clearTimeout(timer);
      }
    },
  );

  const batches = await Promise.all(tasks);
  return { activities: batches.flat(), degraded };
}

function errorReason(err: unknown): string {
  if (err instanceof Error) {
    if (err.message === "BreakerOpen") return "breaker_open";
    if (err.message === "DailyCapExceeded") return "daily_cap_exceeded";
    if (err.name === "AbortError") return "timeout";
    // Cap free-text so a misbehaving provider doesn't blow up log size.
    return err.message.slice(0, 80);
  }
  return "unknown";
}
