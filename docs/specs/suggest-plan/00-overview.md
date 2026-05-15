# 00 — Suggest Plan: Overview

## Summary
A context-aware suggestion surface inside Squad that helps a circle pick *what* and *where* to do, not just *whether* to show up. Given location, budget, weather, time window, and group taste, it returns a small ranked list of candidate activities (restaurants, cafes, movies, events, indoor/outdoor, short trips) the circle can vote on as `plan_venues`.

## Problem statement
Squad replaces the WhatsApp "are we still on?" thread with structured voting (PLAN.md §1). But the upstream question — *"what should we even do?"* — still happens in chat. Today's `plans.location` is free text and `plan_venues` requires a human to type each option. Friction:
- Someone has to remember 3 spots, type them in, hope they're open.
- No accounting for weather (outdoor on a rainy day), budget, or "we did this last week."
- The circle has shared taste (vegetarian-friendly, late-night, near Banjara Hills) that's currently re-litigated every plan.

## Goals
- **Reduce time-to-first-suggestion** from "minutes of typing" to one tap on the create-plan sheet.
- **Surface 3–5 ranked candidates** scoped to the plan's `type`, time window, and circle's preferences.
- **Stay inside the existing plan/venue flow** — suggestions become `plan_venues` rows; the rest of Squad (vote, lock, email) is unchanged.
- **Be honest when stumped** — empty/degraded states (no provider, no signal) must not break create-plan.
- **Future-proof for AI** — provider abstraction + score breakdown make embeddings / LLM ranking a drop-in.

## Success metrics
Mirroring PLAN.md §2 "win condition" — instrumentation, not vanity:
- **Adoption** — ≥40% of new plans started after launch use ≥1 suggested venue (measured via `plan_events.payload.source = 'suggestion'`).
- **Acceptance rate** — of suggestions surfaced, ≥25% are added to the plan as a `plan_venue`.
- **Time-to-create** — median time from "open new-plan sheet" → "submit" drops vs. pre-launch baseline (Vercel Web Analytics custom event).
- **Reject signal honesty** — ≥10% of suggestions get an explicit "not this" tap; pure-positive feedback rate suggests we're not asking the question hard enough.
- **No regression** — Lighthouse on `/c/[slug]` mobile stays 90+.

## Non-goals (this spec)
See `01-goals-and-non-goals.md`. In short: no AI tie-breaking, no autonomous itinerary, no booking/payment, no public discovery.

## Affected modules
- `src/lib/actions/suggest-plan.ts` (new) — server actions for `getSuggestions`, `recordFeedback`.
- `src/lib/suggest/` (new) — pipeline, providers, ranking, normalization.
- `src/lib/validation/suggest.ts` (new) — zod schemas.
- `src/db/schema.ts` — additive only: `suggestion_logs`, `circle_preference_signals` (see `09-data-model.md`).
- `src/components/plan/new-plan-form.tsx` — host the suggestion drawer.
- `src/app/api/plans/[planId]/...` — possible read-only endpoint for refresh.

## Assumptions
- Provider keys (Google Places, OpenWeather, optionally a movies/events API) are env-only and may be missing in dev → pipeline degrades gracefully.
- v1 ships with **one provider per category** behind the abstraction; a 2nd provider per category is a v2 swap, not a code change.
- Geolocation is opportunistic via `navigator.geolocation` (already used in `walking-time-hint.tsx`) and otherwise falls back to circle-level location text + a stored centroid.
