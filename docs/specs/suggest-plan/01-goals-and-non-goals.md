# 01 — Goals & Non-Goals

## In scope (v1 of Suggest Plan)
- Server-side suggestion pipeline that produces a ranked list of 3–5 `Activity` candidates per request.
- Categories: `restaurant`, `cafe`, `movie`, `event`, `indoor`, `outdoor`, `short_trip`. Mapped from `plans.type` (`eat`→restaurant/cafe, `play`→indoor/outdoor/event, `chai`→cafe, `stay-in`→indoor, `other`→all).
- Context inputs: circle centroid + radius, plan time window, optional explicit budget tier, weather snapshot, distance cap, blocked categories.
- Provider abstraction (`SuggestionProvider`) with one default implementation per category in v1.
- Scoring engine with explicit weights, deterministic tie-break, score breakdown returned to client.
- Persistence of suggestion impressions + user feedback (`add`, `reject`, `ignore`) for future learning.
- UI entry point: a "Suggest" affordance inside the existing new-plan sheet that fills the WHERE input(s) with chosen suggestions (i.e. writes to `plan_venues`).
- Refresh action ("Show me different ones") and reject action ("not this one").

## Out of scope (defer to v2 — see `12-future-evolution.md`)
- **Autonomous planning** — Claude picks the plan with no human in the loop.
- **AI tie-breaking on votes** — already in PLAN.md §13.
- **Booking / reservations / payments** — display only.
- **Real-time availability** (table free at 8pm?) — provider data is best-effort.
- **Multi-stop itineraries** ("dinner + a movie + drinks") — single category per suggestion request in v1. The `addition` proposal flow in M24 already covers stacked sub-plans.
- **Cross-circle collaborative filtering** — circle-local signal only in v1 (privacy default).
- **Embedding-based semantic search** — designed for, not built in v1.
- **Custom user-facing weight tuning** — admin-only feature flag at best, not UI.
- **Provider marketplace / pluggable third-party providers** — interface is internal.
- **Push notification when a great suggestion appears** — out of band of M26.
- **Suggestion feeds outside of plan-creation** — no `/c/[slug]/discover`.

## Hard constraints
- **No new dependencies without approval** (CLAUDE.md). Provider HTTP is `fetch`; cache is Postgres rows + in-memory.
- **No schema changes without PLAN.md update first.** Schema additions in `09-data-model.md` must be staged through PLAN.md §5 amendment before migration.
- **Mobile-first** — drawer/sheet UX on 380px. Suggestions render as a vertical list, not a grid.
- **Speed > polish** — first paint of suggestions ≤ 500ms p50 from server (mostly via cache). Provider misses are async-backgrounded with a skeleton.
- **Optimistic UI** — adding a suggestion to the plan is instant; the network is allowed to lag.

## Non-functional boundaries
- All provider calls behind a circuit-breaker style timeout (≤ 1.5s soft, ≤ 3s hard) so the request never blocks plan creation.
- All scoring deterministic given the same inputs → reproducible from log row.
- Feature flag `SUGGEST_PLAN_ENABLED` (env, not DB) to dark-launch by circle slug allowlist if needed.
