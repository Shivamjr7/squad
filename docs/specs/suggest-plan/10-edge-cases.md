# 10 — Edge Cases

Every case lists: **detection → behavior → telemetry**.

## Provider failures

### All activity providers down
- **Detect:** `Promise.allSettled` returns no fulfilled results, or breaker open for all registered providers.
- **Behavior:** Return `RecommendationResult` with `results: []` and full `degraded[]`. UI drawer renders the "Suggest isn't reachable right now — type a venue instead" empty state with **Try again**.
- **Telemetry:** `suggestion_logs.outcome = 'errored'`; Vercel event `suggest_empty` with `reason: 'providers_down'`.

### Single category provider down
- **Detect:** That provider's `Promise.allSettled` entry is `rejected` OR returns empty after retry.
- **Behavior:** Drop the category from the pool; surface other categories' results. Add the dropped provider to `degraded[]`; UI shows a small footnote ("Movies aren't loading right now").
- **Telemetry:** `suggestion_logs.degraded` includes the entry.

### Provider returns malformed payload
- **Detect:** Zod-parsed at the provider boundary; failures throw inside `search()`.
- **Behavior:** Same as "down" path — caught by the surrounding `allSettled`. Breaker counter increments.

### Provider timeout
- **Detect:** AbortController fires at 1.5s.
- **Behavior:** Treated as a failure; **no retry within request** (latency budget).
- **Telemetry:** `degraded[].reason = 'timeout'`.

## Empty results

### Empty after refresh
- **Detect:** `results.length === 0` AND `excludeIds.length > 0`.
- **Behavior:** UI offers **Widen to {next tier} km** CTA. Pipeline does not auto-widen — the user does it explicitly.
- **Telemetry:** `suggestion_logs.outcome = 'empty'`.

### Empty due to threshold
- **Detect:** All candidates scored below 0.35.
- **Behavior:** Fall back to top-3 by `raw` (see `07-ranking-engine.md`); mark items `confidence='low'`; UI shows them under a "Low-confidence picks" subheader.
- **Telemetry:** `suggestion_log_items.feedback` rows tag low-confidence behavior by checking `score < 0.35`.

### Circle has no centroid AND no geolocation
- **Detect:** `geo == null && circleCentroid == null`.
- **Behavior:** Skip distance filtering entirely; `distance` score is neutral 0.5; show a one-time prompt in the drawer to set the circle's home area.
- **Telemetry:** `suggestion_logs.context.cohortMode = 'no_centroid'`.

## Conflicting preferences

### Affinity vs. recency
- **Behavior:** Recency penalty applies regardless of affinity. A high-affinity venue used last weekend will rank below a similar-but-fresh option. Intended — combats "we always go to the same place."

### Hard exclusion overlap with category
- **Detect:** `hardExclusions` excludes the entire resolved category set.
- **Behavior:** Same as "all providers down" empty path — better to be honest than to surface excluded results.

### Recipient cohort produces empty preference profile
- **Detect:** Cohort of 1 with no historical signals.
- **Behavior:** Fall back to circle-wide profile, then to global defaults (all affinities = 0). Annotate explanation lines with no preference-derived templates.

## Weather failures

### Weather provider down
- **Detect:** `WeatherProvider.forecast` rejects or returns null.
- **Behavior:** `weather` is `null`; weather score collapses to neutral 0.6 for `either`, 0.5 elsewhere; outdoor candidates are NOT penalized.
- **Telemetry:** `degraded[].reason = 'weather_unavailable'`.

### Weather forecast outside acceptable bounds
- **Detect:** rain ≥ 1mm OR temp outside [10, 35]°C.
- **Behavior:** Outdoor candidates get `weatherScore = 0.1` (not 0 — sometimes a friend group still wants a brisk walk). Indoor candidates get `1.0`. Explanation template flips to "Indoor pick — feels rainy tonight."

## Invalid filters

### Invalid `distanceKmCap`
- **Detect:** Zod range check (0.5 ≤ x ≤ 100).
- **Behavior:** `ActionError('INVALID', 'distanceKmCap out of range')`. UI surfaces the message via toast.

### Invalid `budgetTier`
- **Detect:** Zod enum.
- **Behavior:** Same as above.

### `timeWindow` start > end
- **Detect:** Computed `endsAtUtc < startsAtUtc` after `zonedWallClockToUtc`.
- **Behavior:** Default end = start + 2h (matches ICS export default in `/api/plans/[planId]/ics`).

### `recipientUserIds` contains non-members
- **Detect:** Cross-check against `memberships`.
- **Behavior:** Silently drop non-members; never `ActionError` (the create-plan form may be racing membership changes). Cohort proceeds with the valid subset.

## Auth / scope

### Caller not a member
- **Detect:** `requireMembership` throws.
- **Behavior:** `ActionError('FORBIDDEN', …)`.

### Caller signed-out (session expired mid-flight)
- **Detect:** `requireUserId` throws.
- **Behavior:** `ActionError('UNAUTHORIZED', …)`; UI redirects to `/sign-in` via existing handler.

## Race conditions

### Plan submitted while drawer is open
- **Detect:** Submission references `suggestionLogId` rows that no longer make sense (e.g. recipients changed).
- **Behavior:** `plan_venues.source='suggestion'` rows are written best-effort; if `suggestionItemId` is no longer resolvable, fall back to `source='manual'` for that row and log a `plan_event` of kind `suggestion_added` with `payload.warning = 'item_unresolved'`. Plan creation does not fail.

### Concurrent refreshes from the same device
- **Detect:** Same `requestNonce` reused.
- **Behavior:** Idempotency via the unique index — returns the cached log row.

### Rapid taps on the same suggestion card ("add → undo → add")
- **Detect:** Multiple `recordFeedback` calls for the same `(suggestionLogId, itemId)`.
- **Behavior:** Latest `feedback` wins (UPDATE on conflict). `feedbackAt` reflects most recent.

## Privacy

### Geolocation accuracy is low (>1km)
- **Detect:** `geo.accuracyMeters > 1000`.
- **Behavior:** Treat as `geo: undefined` for distance scoring; still allow walking-time hint to surface its own message.

### User on shared network with multiple accounts
- Not detected; out of scope. The rate-limit per user covers the abuse case.
