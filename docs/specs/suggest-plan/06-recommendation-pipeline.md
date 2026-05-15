# 06 — Recommendation Pipeline

End-to-end flow inside `getSuggestions`. Each step is its own function in `src/lib/suggest/pipeline/*.ts` so that any stage can be swapped (e.g. swap `rank.heuristic.ts` for `rank.llm.ts` in v2).

## High-level shape
```
gatherContext → fetchActivities → normalize → filter → score → rank → explain → log → respond
```

Each arrow is a typed transform; no step mutates upstream data.

## Step 1 — `gatherContext`
**File:** `src/lib/suggest/pipeline/gather-context.ts`
1. Resolve `categories` from `planType` (mapping table in `03-functional-requirements.md`).
2. Build `timeWindow` by reusing `zonedWallClockToUtc` from `src/lib/tz.ts`.
3. Resolve `circleCentroid`:
   - Prefer `circles.home_lat / home_lng` (new column, `09-data-model.md`).
   - Else fall back to centroid of the last 10 `plan_venues` with geocodes for this circle.
   - Else null → pipeline runs in "category-only" mode (no distance filter, no weather).
4. Fetch `GroupPreferenceProfile` (in-memory LRU first).
5. Fetch `WeatherSnapshot` in parallel with steps 6's providers (don't block on it).
6. Default `distanceKmCap` table:
   | category | default km |
   |---|---|
   | restaurant / cafe / chai | 3 |
   | indoor / event / movie | 8 |
   | outdoor | 10 |
   | short_trip | 50 |

## Step 2 — `fetchActivities`
**File:** `src/lib/suggest/pipeline/fetch-activities.ts`
- For each resolved category, look up its registered `SuggestionProvider`.
- Fire all provider `search()` calls in parallel with `Promise.allSettled`.
- Each call wrapped in:
  - `AbortController` with 1.5s soft / 3s hard timeout.
  - Circuit breaker (in-memory; opens after 3 consecutive 5xx, half-open after 60s).
  - `provider_cache` lookup before network.
- Failures recorded into `degraded[]` but never thrown.

## Step 3 — `normalize`
**File:** `src/lib/suggest/pipeline/normalize.ts`
Each provider returns `Activity[]` already shaped, but normalize:
- Compute `distanceMeters` from `geo` + `circleCentroid` (or `geo` if available) using Haversine.
- Normalize ratings to a 0–5 float.
- Map provider-specific price (e.g. Google `price_level` 0–4) to `'$'|'$$'|'$$$'|'$$$$'`.
- De-dup across providers (`Activity.id` first, then name+50m fuzz).

## Step 4 — `filter`
**File:** `src/lib/suggest/pipeline/filter.ts`
- Hard: distance ≤ cap (skip if no centroid), category in set, opening hours intersect window (skip if `is_approximate`).
- Soft (penalties, not exclusions, see `07-ranking-engine.md`): budget mismatch, weather mismatch, recency.
- Hard exclusion list from `GroupPreferenceProfile.hardExclusions` (v2-shaped but enforced if present).
- `excludeIds` final pass.

## Step 5 — `score`
**File:** `src/lib/suggest/pipeline/score.ts`
For each surviving candidate, compute `ScoreBreakdown` independently then combine with weights. See `07-ranking-engine.md` for formulae.

## Step 6 — `rank`
**File:** `src/lib/suggest/pipeline/rank.ts`
- Sort by combined score desc.
- Apply category diversity rule: cap any single category to `ceil(limit/2)` so we don't return five identical pizzerias.
- Tie-break order: higher rating → closer distance → lower price → stable provider sort.
- Truncate to `limit` (default 5).

## Step 7 — `explain`
**File:** `src/lib/suggest/pipeline/explain.ts`
Template-based, deterministic. Pick the **top 2 score components** for the activity, plus one always-true fact (distance or open-till), and concat into a one-liner.

Example templates (chosen by which breakdown component is highest):
- `distance` top: `"Cafe • {minutes} min walk • open till {closeTime}"`
- `preference` top: `"Squad liked similar spots — {tag} • {distanceKm} km"`
- `weather` top: `"Indoor pick — feels rainy tonight"`
- `recency` top: `"You haven't been here in {weeks} weeks"`

LLM-based explanation is a v2 swap; the call site is one function.

## Step 8 — `log`
**File:** `src/lib/suggest/pipeline/log.ts`
- Insert one row into `suggestion_logs` with the full `SuggestionContext` snapshot (PII-scrubbed; lat/lng quantized to geohash-6).
- Insert one row per result into `suggestion_log_items` with `activity` (jsonb) + `breakdown` (jsonb).
- Returns `suggestionLogId`.

## Step 9 — `respond`
Compose `RecommendationResult` and return. **Total budget: 500ms p50 / 1.5s p95.**

## Concurrency / sequencing diagram (text form)
```
gatherContext (sync: 10ms)
   ├─ fetch GroupPreferenceProfile (cache hit: <5ms)
   └─ kick off WeatherProvider.forecast (async, capped 1s)
fetchActivities (parallel providers, capped 1.5s)
   ↳ normalize + filter (sync: ~5ms per 100 items)
[await weather]                         ← block here only if outdoor is in mix
score + rank + explain (sync: ~10ms)
log (single Postgres round trip; jsonb insert)
```

## Refresh re-entry
- Same pipeline; `excludeIds` populated from the previous run's `suggestion_log_items.activity.id`.
- The previous run's log row is **kept** with `outcome = 'refreshed'` set lazily.
