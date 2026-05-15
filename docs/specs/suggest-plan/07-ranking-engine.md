# 07 — Ranking Engine

## Design rule
Explicit, debuggable, deterministic. v1 ships a linear weighted sum, not an ML model. Every result includes its `ScoreBreakdown` so the engineering team (and a future LLM ranker) can replay decisions.

## Score components
Each ∈ [0, 1]. Computed independently in `pipeline/score.ts`.

### `distance`
```
distanceScore = max(0, 1 - distanceMeters / (distanceKmCap * 1000))
```
- Null centroid → `distanceScore = 0.5` (neutral, do not penalize).

### `preference`
```
preferenceScore =
  0.5
  + 0.25 * sigmoid(categoryAffinity[activity.category])
  + 0.25 * mean(cuisineAffinity[t] for t in activity.tags if t in cuisineAffinity)
```
- Sigmoid maps the [-1,1] affinity to (0,1).
- `mean` over zero matches yields 0.5 (no signal).
- Clamped to [0,1].

### `weather`
```
if activity.weatherSensitivity == 'outdoor':
  weatherScore = weatherIsAcceptable(weather) ? 1.0 : 0.1
elif activity.weatherSensitivity == 'indoor':
  weatherScore = weatherIsAcceptable(weather) ? 0.7 : 1.0  // indoor wins on bad weather
else:
  weatherScore = 0.6
```
- `weather == null` → `0.5` (neutral).
- `weatherIsAcceptable` = no rain ≥ 1mm forecast, temp in [10°C, 35°C].

### `recency`
```
weeksSinceLast = (now - mostRecentMatch.lastUsedAt) / 7 days
recencyScore = clamp01(weeksSinceLast / 6)  // ≥6 weeks ago = full credit
no match → 1.0
```
- Match = same `Activity.id` or fuzzy name match in `circle_preference_signals`.

### `budget`
```
delta = abs(priceTierIndex(activity) - priceTierIndex(ctx.budgetTier))
budgetScore = max(0, 1 - 0.4 * delta)
```
- `ctx.budgetTier == null` → `1.0`.
- `priceTier` missing → `0.7` (mild penalty for unknown).

### `hours`
```
windowMin = ctx.timeWindow.startsAtUtc, windowMax = ctx.timeWindow.endsAtUtc
overlap = minutesOverlap(activity.openingHours, [windowMin, windowMax])
hoursScore = clamp01(overlap / max(60, windowDurationMinutes))
```
- `openingHours` missing → `0.7` (unknown but not disqualifying).
- `ctx.isApproximate == true` → `hoursScore = 1.0` (don't penalize fuzzy times).

### `popularity`
```
popularityScore = clamp01( log10(1 + rating.count) / 4 ) * (rating.score / 5)
```
- Missing rating → `0.5`.
- Capped at 1 (a 10k-review place won't dominate over taste signals).

## Weights (v1 defaults)
```
W = {
  distance:    0.20,
  preference:  0.25,
  weather:     0.10,
  recency:     0.10,
  budget:      0.10,
  hours:       0.15,
  popularity:  0.10,
}
```
Weights sum to 1.0. Sourced from `src/lib/suggest/weights.ts` so they're trivially overridable (env var `SUGGEST_WEIGHTS_JSON`) for experimentation without redeploy.

## Combined score
```
raw = Σ W[k] * breakdown[k]
score = clamp01(raw)
```
The `raw` value is stored on `ScoreBreakdown.raw` for debugging.

## Confidence label
Coarse bucketing, used in UI:
- `score ≥ 0.75` → `high`
- `0.55 ≤ score < 0.75` → `medium`
- otherwise → `low`

## Tie-breaking
On `score` equality (within 0.005):
1. Higher `rating.score`.
2. Closer `distanceMeters`.
3. Lower `priceTier` index (cheaper wins).
4. Stable provider order: `tmdb < eventbrite < google_places` (movies and events outrank generic places for `play`/`other` requests).
5. Lexicographic `activity.id` (final, deterministic).

## Diversity rule
After sort, enforce per-category cap = `ceil(limit / 2)`. Excess candidates push down. Prevents "5 cafes" when 2 cafes + 2 indoor + 1 event would be better.

## Filtering thresholds
- Drop any candidate with `score < 0.35`. If this empties the list, **fall back** to the top-3 by raw without threshold — telemetry marks it `low_confidence_result = true`.
- Drop candidates with `breakdown.hours == 0` (strictly closed during window) unless `isApproximate`.

## Determinism guarantees
- Same `SuggestionContext`, same `provider_cache` hits, same `circle_preference_signals` snapshot → identical `RankedResult[]`.
- A `suggestion_logs` row can be re-ranked offline by reading its stored snapshot + items.

## Why linear sum (and not ML) in v1
- 7 components, debuggable, no training data yet, no infra needed.
- A future `RankStrategy` interface (already implicit in `pipeline/rank.ts`) lets us drop in a learned ranker once we have ≥ 10k `suggestion_log_items` with feedback.
