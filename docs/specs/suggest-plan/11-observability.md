# 11 — Observability

## Principles
- **Every result is reproducible from logs alone.** `suggestion_logs` + `suggestion_log_items` carry enough to rerank offline.
- **Prefer structured logs over metrics infra.** Squad runs on Vercel + Supabase — no Prometheus, no Datadog. We use Vercel logs + Postgres queries.
- **Privacy first.** No raw PII, no raw provider payloads in logs.

## Metrics (Postgres-derived dashboards in `/c/[slug]/stats` admin page)
M27 already promises a stats page. We extend it with a "Suggestions" tab.

| Metric | Source | Computation |
|---|---|---|
| Suggestion fetch p50/p95 latency | log line (see below) | percentile over last 7d |
| Drawer open rate | Vercel Web Analytics `suggest_open` | per-plan-creation session |
| Acceptance rate | `suggestion_log_items.feedback='add'` | adds / impressions |
| Reject rate | `feedback='reject'` | rejects / impressions |
| Refresh rate | `feedback='refresh'` | refreshes / impressions |
| Won rate | `feedback='won'` | wins / adds |
| Cancellation-after-add rate | `feedback='cancelled'` / `add` | quality check |
| Provider availability | `suggestion_logs.degraded` jsonb | per-provider degraded count / total |
| Empty result rate | `outcome='empty'` | / total |
| Low-confidence fallback rate | items with `score < 350` (int) | / surfaced |

## Logs (Vercel + Postgres)
- **Structured per-request log line** emitted by `getSuggestions` at end of pipeline:
  ```
  level=info evt=suggest.served logId=<uuid> circleId=<id>
    categories=eat,cafe limit=5 ms_total=420
    ms_providers=380 ms_weather=180 ms_rank=8 ms_log=22
    providers_ok=google_places providers_down=tmdb,evb
    results=4 confidence_high=2 confidence_low=0
    outcome=served low_conf_fallback=false
  ```
- **Error path** logs `level=error evt=suggest.errored` with the same shape minus latencies, plus `err.code`.
- **Provider-level** logs only on breaker state transitions: `evt=suggest.breaker provider=google_places state=open`.
- Use `console.log` (Vercel captures it). No external logger.
- All log lines are single-line JSON-ish kv to make `vercel logs | grep evt=suggest` trivial.

## Tracing
- We do NOT introduce OpenTelemetry in v1 (no new dep).
- Each pipeline stage records its duration in `suggestion_logs.context.timings` (jsonb subfield), giving us per-request "trace" without a tracer:
  ```
  context.timings = { gather: 8, fetch: 380, normalize: 4, filter: 2, score: 6, rank: 1, explain: 3, log: 22 }
  ```
- For one-off deep dives, the log id can be fed to a debug route (admin-only, gated like `/c/[slug]/stats`) that pretty-prints the snapshot.

## Analytics signals
- Vercel Web Analytics custom events, fired client-side from the drawer:
  - `suggest_open` — drawer mounted, `{ planType }`
  - `suggest_add` — item added, `{ rank, confidence, category }`
  - `suggest_reject` — item rejected, `{ rank, category }`
  - `suggest_refresh` — refresh tap, `{ remainingCount }`
  - `suggest_empty` — empty pool surfaced, `{ reason }`
- These are aggregate / anonymous; no user id.

## Alerts (lightweight)
- **No paging infra in v1.** A weekly admin email summary (via existing Resend infra) runs from a pg_cron job (mirroring M15) and reports:
  - Acceptance rate over last week
  - Total provider degradations
  - Cost-cap hits (`provider_cache.metadata.dailyCount` exceeded)
- The body of the email is plaintext; lives in `src/lib/email-templates.ts` as `suggestStatsEmail()`.

## Health checks
- `GET /api/plans/[planId]/ics` exists as a precedent for cron-callable routes. We add `GET /api/suggest/health` (admin-only via the existing webhook auth pattern) returning JSON:
  ```
  { providers: { google_places: 'ok', openweather: 'ok', tmdb: 'down' },
    cache_size_rows: 1234, last_cache_vacuum: '…' }
  ```
- This route also probes each `SuggestionProvider.health?()` if implemented.

## Privacy & retention
- `suggestion_logs.context` strips lat/lng to geohash6 (~1.2km) before insert.
- Retention: `suggestion_logs` rows older than 180 days are deleted by a daily pg_cron job (`vacuum-suggestion-logs`). Aggregated metrics persist in a small `suggestion_metrics_daily` rollup table (optional — added only if dashboards become slow).
- No third-party analytics → no extra exposure beyond Vercel/Supabase.
