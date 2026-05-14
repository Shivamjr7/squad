# 08 — Provider Architecture

## Goals
- One interface per data domain (activities, weather).
- Providers are **stateless modules**, registered at app boot.
- Adding a provider = one file, one entry in the registry, no other code changes.
- Failures isolated — one provider down does not break the pipeline.

## Module layout
```
src/lib/suggest/
├── types.ts                 # SuggestionContext, Activity, …
├── weights.ts               # ranking weights
├── pipeline/                # gather → rank → explain → log (see §06)
├── providers/
│   ├── registry.ts          # provider lookup, env gating
│   ├── google-places.ts     # SuggestionProvider impl
│   ├── tmdb.ts              # movies (optional in v1)
│   ├── eventbrite.ts        # events (optional in v1)
│   └── openweather.ts       # WeatherProvider impl
├── cache/
│   ├── provider-cache.ts    # Postgres-backed (table provider_cache)
│   └── memory-lru.ts        # in-process, used for GroupPreferenceProfile
└── prefs/
    ├── aggregator.ts        # builds GroupPreferenceProfile
    └── signals.ts           # writes/reads circle_preference_signals
```

## `SuggestionProvider` interface
Defined in `04-domain-model.md`. Recap:
```ts
interface SuggestionProvider {
  readonly name: string;
  readonly categories: ActivityCategory[];
  search(input: ProviderSearchInput, signal: AbortSignal): Promise<Activity[]>;
  health?(): Promise<'ok'|'degraded'|'down'>;
}
```

### Responsibilities of an implementation
1. **HTTP via `fetch`** (no axios; no new dep).
2. **Respect `signal`** — every fetch call must pass `signal` through; uncooperative SDKs are not allowed.
3. **Normalize** to the `Activity` shape. Provider-specific raw is discarded after normalization (we don't store it; saves bytes and PII risk).
4. **Stable IDs** — prefix with provider name: `gp:<place_id>`, `tmdb:<movie_id>`, `evb:<event_id>`.
5. **Self-cache eligible** — pure read; the pipeline cache key is `(name, hash(input))` so providers don't need their own.
6. **Read env at module level**, fail fast with a `readiness()` log line at boot; do not throw.

## Registry semantics
- `registry.ts` builds a `Map<ActivityCategory, SuggestionProvider>` once per process.
- If multiple providers cover a category, the first registered wins. v1 has exactly one per category.
- Categories without a provider are not requested at all — they end up in `degraded[]` with reason `no_provider`.

## Weather provider
- Singleton, used by `gather-context.ts`. Separate interface (`WeatherProvider`) because its inputs differ (single point, not search).
- Failure → `weather: null` in context → ranking falls back to neutral 0.5 weather score.

## Normalization strategy
- Common helpers in `pipeline/normalize.ts` so we don't duplicate per provider:
  - `haversineMeters(a, b)`
  - `normalizePriceTier(raw: unknown, provider: string)`
  - `parseOpeningHours(raw: unknown, provider: string)` — Google Places format → `OpeningHours`.
  - `parseWeatherConditions(raw: unknown)` → `'clear'|'rain'|…`.
- Providers DO their best to fill optional fields; missing fields are tolerated (see scoring defaults in §07).

## Caching expectations
- `provider_cache` is the primary surface:
  - `key = sha256(provider.name + ':' + canonicalJson(input))`
  - `ttl_seconds` per provider, set in `provider-cache.ts`.
  - `value jsonb` stores the normalized `Activity[]`, NOT raw provider payload.
  - Hits short-circuit `search()`.
- In-memory micro-cache (5s) on top of Postgres cache for the same key within a single process, to absorb double-tap bursts from the drawer.

## Retry / timeout / breaker
- Per-call timeout: 1.5s soft (race against AbortController), 3s hard.
- **No retries inside a request** — retrying inside the 500ms p50 budget is a contradiction. Retries happen on next user request.
- Circuit breaker, in-memory per process, per provider:
  - Open after 3 consecutive 5xx or timeouts in 60s window.
  - Half-open after 30s; one canary request decides.
  - Open state → provider treated as `down`, immediately added to `degraded[]`.

## Cost control
- Hard daily ceiling per provider, configurable via env `SUGGEST_<PROVIDER>_DAILY_CAP` (e.g. 5000 / day).
- A Postgres counter table (`provider_cache.metadata.daily_count`) is incremented on cache miss; once exceeded, treated as `down`.
- This is intentionally simple — no Redis. Squad's volume is friend-group scale.

## Privacy
- Provider inputs use `circleCentroid` or **quantized** user geohash, never raw lat/lng beyond 5 decimal places.
- Provider outputs are stored in `suggestion_log_items.activity` (jsonb) so reproducibility doesn't require re-hitting providers. But raw API responses are NEVER stored.

## Testing seams
- `registry.ts` exposes a `setProvider(category, mock)` for test-only use (gated by `process.env.NODE_ENV === 'test'`).
- Network is mocked in tests by default; CI must not hit live providers.
