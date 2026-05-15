// Client-side, in-memory cache for `getSuggestions` results. Lives in the
// browser process for the lifetime of the page — survives drawer close/open
// cycles, clears on navigation/reload. Keeps the suggestion drawer feeling
// instant on re-opens with the same inputs, and stops us from billing the
// providers (Google Places, TMDB, etc.) for re-queries that wouldn't change.
//
// Scope: client-only. Server-side caching is handled by the per-provider
// Postgres cache (src/lib/suggest/cache/provider-cache.ts) and by the
// (userId, requestNonce) idempotency check in the action layer. This cache
// is the additional layer that prevents the network round trip itself.
//
// Invalidation:
//   - Explicit: the drawer's Refresh button calls invalidateSuggestions()
//     before the new fetch.
//   - Implicit: 5-minute TTL — long enough to absorb the typical "open,
//     close, open again" cycle, short enough that movie showtimes /
//     opening hours don't drift far from the live state.
//   - Per-key: changing planType / distance / geo bucket / startsAtLocal
//     resolves to a different key, so a new search is a different entry.

import type { RecommendationResult } from "./types";

const TTL_MS = 5 * 60_000;
// Soft ceiling so stale entries from forgotten distance/planType combos
// can't grow unbounded in long-lived tabs. LRU isn't needed at friend-
// group scale — the cap is mostly defensive.
const MAX_ENTRIES = 32;

type Entry = {
  result: RecommendationResult;
  expiresAt: number;
};

// Module-level Map. Survives component unmount/remount because the module
// itself lives in the JS heap for the page lifetime.
const cache = new Map<string, Entry>();

export type CacheKeyInput = {
  circleId: string;
  planType: string;
  distanceKmCap: number;
  /** ISO yyyy-mm-ddTHH:MM. */
  startsAtLocal: string;
  timeZone: string;
  geo?: { lat: number; lng: number } | null;
};

/**
 * Stable cache key. Geo coords are rounded to 3 decimals (~110 m) so
 * GPS jitter doesn't bust the cache when the user is sitting still. Same
 * resolution the server uses when scrubbing context for `suggestion_logs`.
 */
export function makeCacheKey(input: CacheKeyInput): string {
  const geoBucket = input.geo
    ? `${input.geo.lat.toFixed(3)}_${input.geo.lng.toFixed(3)}`
    : "no-geo";
  return [
    input.circleId,
    input.planType,
    input.distanceKmCap,
    input.startsAtLocal,
    input.timeZone,
    geoBucket,
  ].join("::");
}

export function getCachedSuggestions(
  key: string,
): RecommendationResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  // Re-insert to refresh LRU recency.
  cache.delete(key);
  cache.set(key, entry);
  return entry.result;
}

export function setCachedSuggestions(
  key: string,
  result: RecommendationResult,
): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { result, expiresAt: Date.now() + TTL_MS });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function invalidateSuggestions(key: string): void {
  cache.delete(key);
}

/** Drop everything. Used by tests; exported so a manual "clear cache"
 *  affordance is one line away if we ever need one. */
export function clearSuggestionCache(): void {
  cache.clear();
}

// Internals for testing only.
export const __internals = { cache, TTL_MS, MAX_ENTRIES };
