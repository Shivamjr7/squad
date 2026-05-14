# Implementation Plan — Suggest Plan

Sequenced like PLAN.md §10 milestones: each phase ends with `pnpm lint && pnpm build` green, a working Vercel deploy, and a commit `sN: <description>` (`s` = suggest series). No phase starts until the previous phase is merged.

## Dependencies (top-down)
```
S1 (PLAN.md amendment + schema)
   ↳ S2 (types + zod + provider interfaces, no network)
        ↳ S3 (one provider impl + provider cache)
             ↳ S4 (pipeline scaffolding + ranking engine)
                  ↳ S5 (server actions + idempotency + rate limit)
                       ↳ S6 (drawer UI inside new-plan-form)
                            ↳ S7 (persistence: feedback writes, plan_events extension)
                                 ↳ S8 (analytics + admin stats tab)
                                      ↳ S9 (provider expansion + hardening + ship)
                                           ↳ S10 (AI seam: explanation/ranker pluggability)
```

## Phase S1 — PLAN.md amendment + schema land
**Goal:** Get the data model in main with empty tables; nothing user-visible.
- Update PLAN.md §5 with the new tables (`circle_preference_signals`, `suggestion_logs`, `suggestion_log_items`, `provider_cache`) and the column additions to `circles` and `plan_venues`. **Stop and confirm with user before continuing** (CLAUDE.md rule).
- Add Drizzle definitions in `src/db/schema.ts` (additive only).
- `pnpm db:generate` → review migration → `pnpm db:migrate` against Supabase staging.
- Add seed entries in `src/db/seed.ts` for `circle_preference_signals` smoke data (optional).
- Lighthouse + build green. Commit `s1: schema for suggest plan`.

## Phase S2 — Contracts and provider interfaces
**Goal:** Compile-time-only scaffolding. Zero network calls.
- New files:
  - `src/lib/suggest/types.ts` — `Activity`, `SuggestionContext`, `GroupPreferenceProfile`, `ScoreBreakdown`, `RankedResult`, `RecommendationResult`, `SuggestionProvider`, `WeatherProvider`.
  - `src/lib/suggest/weights.ts` — default weights, `loadWeights()` reading `SUGGEST_WEIGHTS_JSON`.
  - `src/lib/validation/suggest.ts` — zod schemas for `getSuggestionsSchema`, `recordFeedbackSchema`.
  - `src/lib/suggest/providers/registry.ts` — `getProvider(cat)`, `registerProvider()`, `setProvider()` (test only).
- No runtime behavior change. `pnpm lint && pnpm build` green. Commit `s2: contracts + provider interfaces`.

## Phase S3 — Google Places provider + cache + breaker
**Goal:** One working end-to-end provider that can return normalized Activities.
- `src/lib/suggest/providers/google-places.ts` — `search()` calling Places Nearby Search via `fetch`; map fields per `normalize.ts` helpers.
- `src/lib/suggest/cache/provider-cache.ts` — Postgres-backed get/set with TTL.
- `src/lib/suggest/cache/memory-lru.ts` — 5s micro-cache.
- Circuit breaker, in-process (per provider). No infra.
- Unit tests for normalization (no network); a single contract test gated behind `RUN_LIVE_PROVIDER_TESTS=1` env.
- Env: `GOOGLE_PLACES_API_KEY` documented in `.env.example`.
- Commit `s3: google places provider + cache`.

## Phase S4 — Pipeline + ranking
**Goal:** Pure functions; given mock providers, the pipeline returns ranked results.
- Files under `src/lib/suggest/pipeline/`: `gather-context.ts`, `fetch-activities.ts`, `normalize.ts`, `filter.ts`, `score.ts`, `rank.ts`, `explain.ts`, `log.ts`, `index.ts` (orchestrator).
- `prefs/aggregator.ts` + `prefs/signals.ts` — read/write `circle_preference_signals`; on first run, signals are empty (neutral profile).
- Unit tests against pinned mock providers cover: distance scoring, weather penalty, recency, diversity cap, tie-break, threshold fallback, deterministic ordering.
- No server action wiring yet. Commit `s4: pipeline + ranking engine`.

## Phase S5 — Server actions
**Goal:** Action layer with idempotency + rate limiting + error mapping.
- `src/lib/actions/suggest-plan.ts`:
  - `getSuggestions(input)` — uses `requireMembership`; runs pipeline; writes `suggestion_logs` + items; returns shape from §05.
  - `recordFeedback(input)` — updates the item row; emits a `plan_event` of kind `suggestion_added`/`suggestion_rejected` when applicable.
- In-process rate limit (token bucket per user, 20/min). Gate is intentionally simple; can move to Postgres later if abused.
- All `ActionError` codes wired.
- Commit `s5: server actions + idempotency + rate limit`.

## Phase S6 — Drawer UI inside new-plan-form
**Goal:** User can see suggestions and add them to plan_venues. Mobile-first.
- `src/components/plan/suggest-drawer.tsx` — full-screen sheet on mobile (`sm:` and below), side panel on `md:`. Built on existing `radix-ui` primitives already in deps.
- Inserted into `src/components/plan/new-plan-form.tsx` as a `Suggest` button next to the "Add another option" affordance.
- Optimistic add: tapping **Add** writes a chip in the WHERE list with the ✨ marker; the actual `plan_venues.source='suggestion'` insert happens at plan-submit time alongside other venue rows.
- Reject + refresh wired to `recordFeedback`.
- Geolocation: piggyback on existing `walking-time-hint.tsx` permission pattern; never blocks the drawer.
- Empty / degraded / loading states per `10-edge-cases.md`.
- Test on a 380px viewport, real Android if possible (CLAUDE.md mobile rule).
- Commit `s6: suggest drawer UI`.

## Phase S7 — Persistence + lifecycle hooks
**Goal:** Close the feedback loop end-to-end.
- Extend `src/lib/actions/auto-lock.ts` to write `feedback='won'` on suggestion-sourced winning venues.
- Extend `src/lib/actions/plans.ts` `cancelPlan` to write `feedback='cancelled'` for any attached suggestion venues.
- Extend `plan_events` kinds: add `'suggestion_added'`, `'suggestion_rejected'` (enum migration — additive). Update `src/db/schema.ts` `planEventKind`.
- Receipt variant in `components/plan/receipt.tsx` already iterates `plan_events`; verify the new kinds render with a sensible label.
- Commit `s7: feedback writes + receipt integration`.

## Phase S8 — Analytics + admin stats
**Goal:** Make adoption observable.
- Vercel Web Analytics custom events from the drawer (`suggest_open|add|reject|refresh|empty`).
- New tab in `/c/[slug]/stats` (M27 feature) under "Suggestions": acceptance rate, reject rate, top categories, low-confidence fallback rate, degraded-provider counts. Admin only.
- Weekly summary email via Resend (`src/lib/email-templates.ts:suggestStatsEmail`) gated by a pg_cron job.
- Commit `s8: analytics + admin stats`.

## Phase S9 — Provider expansion + hardening + ship
**Goal:** Production-ready breadth.
- Add `openweather.ts` (WeatherProvider) — gated by `OPENWEATHER_API_KEY` env.
- Add `tmdb.ts` (movies) and `eventbrite.ts` (events) behind env keys; if missing, registry quietly skips (no crash).
- Add the `vacuum-provider-cache` and `vacuum-suggestion-logs` pg_cron jobs (mirror M15 SQL).
- Lighthouse 90+ mobile on `/c/[slug]` re-verified.
- Friend-group dogfood for one weekend before public to circle.
- Commit `s9: weather + optional providers + cron + ship`.

## Phase S10 — AI seam
**Goal:** Make the v2 swap mechanical.
- Refactor `pipeline/explain.ts` to register an `ExplanationStrategy` (template vs. LLM).
- Refactor `pipeline/rank.ts` to register a `RankStrategy` (heuristic vs. LLM scoring) — interface only, default unchanged.
- Document the seam in `docs/specs/suggest-plan/12-future-evolution.md` and link from `README.md` if/when added.
- No dep changes; no behavior change for users.
- Commit `s10: strategy seams for AI evolution`.

## Cross-phase contracts
- **No dep additions** without explicit user sign-off (CLAUDE.md). The only candidate is `pgvector` in S10+ for embeddings — explicitly punted.
- **No schema changes** without PLAN.md §5 amendment landing first.
- **Every phase** ends with `pnpm lint && pnpm build` green and a mobile DevTools pass.
- **No feature creep** — features listed only in `12-future-evolution.md` stay out of v1 even if a phase looks easy to extend.

## Risk register
| Risk | Mitigation |
|---|---|
| Google Places cost overrun | `SUGGEST_GOOGLE_PLACES_DAILY_CAP`, provider cache, lazy fetch (only on Suggest tap) |
| Slow drawer on cold start | Postgres provider cache primed by first user's request; in-memory LRU for subsequent |
| Friends don't trust suggestions | Score breakdown + explanation line make ranking debuggable; reject + refresh are first-class |
| Schema sprawl | All new tables are additive; cascade rules documented; retention pg_cron prevents unbounded growth |
| AI swap is harder than promised | S10 enforces strategy seams; both `explain` and `rank` are single-function call sites today |
