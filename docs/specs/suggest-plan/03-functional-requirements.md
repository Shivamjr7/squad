# 03 — Functional Requirements

## Inputs (`SuggestionContext`)
Source-tagged so partial contexts are first-class. See `04-domain-model.md` for the TS shape.

| Input | Source | Required? | Notes |
|---|---|---|---|
| `circleId` | server | yes | Auth-scoped via `requireMembership` |
| `planType` | client | yes | `eat`/`play`/`chai`/`stay-in`/`other` → category set |
| `categories` | derived | yes | Resolved server-side from `planType` (overridable in v2) |
| `timeWindow` | client | yes | `{ startsAtUtc, endsAtUtc, isApproximate, timeZone }` |
| `geo` | client | no | `{ lat, lng, accuracyMeters }` from `navigator.geolocation` |
| `circleCentroid` | server | yes (fallback) | `circles.home_lat / home_lng` or last-known plan venue cluster |
| `distanceKmCap` | client | no | Default 3km eat/chai, 10km play, 50km short_trip; widen-tiered |
| `budgetTier` | client | no | `'$' | '$$' | '$$$' | null` (null = any) |
| `excludeIds` | client | no | Provider-stable IDs already shown / rejected |
| `recipientUserIds` | server | no | Mirrors M23 `plan_recipients`; aggregates preferences over this subset |
| `weather` | derived | no | Snapshot from weather provider for `timeWindow` |
| `groupPreferences` | derived | yes | Computed from `GroupPreferenceProfile` aggregator |

## Outputs (`RecommendationResult`)
Stable shape regardless of provider:
```
{
  suggestionLogId: string,          // FK target for feedback
  generatedAt: string,              // ISO timestamp
  results: Array<{
    id: string,                     // suggestion_log_item id (our id)
    activity: Activity,             // normalized record
    score: number,                  // 0..1
    breakdown: ScoreBreakdown,      // explainable
    explanation: string,            // one-line, user-facing
    confidence: 'high'|'medium'|'low',
    provider: string,               // 'google_places' | 'weather' | …
  }>,
  degraded?: Array<{ provider: string, reason: string }>,
}
```

## Supported categories
Initial seven, each owned by exactly one provider in v1:
- `restaurant` — Google Places (Type=restaurant)
- `cafe` — Google Places (Type=cafe)
- `movie` — TMDB *now-playing* (deferred to v1.5 if no key configured)
- `event` — Eventbrite or similar (deferred to v1.5 if no key)
- `indoor` — Google Places (Types: bowling_alley, museum, art_gallery, shopping_mall — curated whitelist)
- `outdoor` — Google Places (Types: park, tourist_attraction) — only if weather is acceptable
- `short_trip` — Google Places (Types: tourist_attraction within 25–100km radius)

Categories with no configured provider in env are returned as `degraded` with reason `no_provider`; the pipeline does not crash.

## Filtering requirements
Applied in order:
1. **Hard filters** — distance ≤ cap, opening_hours intersect time window (loosened if `isApproximate`), category in resolved set.
2. **Soft filters** — budget tier match (penalty, not exclusion), weather suitability (penalty for outdoor in bad weather), `excludeIds`.
3. **De-dup** — by provider-stable ID, then by name+geo fuzz (Levenshtein ≤ 2 within 50m).
4. **Recency** — penalize venues with a `plan_venue.label` match in the last 14 days for this circle (signal stored in `circle_preference_signals`).

## Constraints
- **Auth** — caller must be a member of `circleId` (`requireMembership`).
- **Rate limits** — max 20 suggestion requests / minute / user. Hit returns HTTP 429 + drawer surfaces "slow down a sec."
- **PII** — never log raw user lat/lng to `suggestion_logs`; store a quantized geohash (precision 6, ~1.2km).
- **Determinism** — given identical context + same provider responses + same `circle_preference_signals` snapshot, ranking is reproducible.
- **Latency budget** — p50 ≤ 500ms, p95 ≤ 1500ms. Provider timeouts ≤ 1.5s soft.

## Non-requirements
- No streaming response; one shot per request.
- No client-side ranking; server is authoritative.
- No background pre-fetching when the new-plan sheet opens (cost concern). Lazy on the **Suggest** tap.
