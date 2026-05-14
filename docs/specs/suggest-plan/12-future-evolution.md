# 12 — Future Evolution

The v1 shape is intentionally boring so the v2 swaps are mechanical. Each block below names the v1 hook it plugs into.

## Embeddings
- **Goal:** Replace tag-based `cuisineAffinity` matching with semantic similarity.
- **Hook:** `pipeline/score.ts` `preferenceScore`. Today it sums tag affinities; in v2, it queries an `activity_embeddings` table and computes cosine similarity against the circle's averaged "taste vector."
- **Add:**
  - `activity_embeddings(id text pk, provider text, vector vector(384))` (pgvector extension on Supabase).
  - Background job: when a new `plan_venues` row is locked with `feedback='won'`, embed `activity.name + tags + description` and upsert.
  - Circle taste vector = exponential-moving-average of last 50 `won` activities' vectors.
- **Why it's safe:** `Activity` already carries `tags` + `description`; embedding is a side-table, not a schema rewrite.

## Semantic recommendations
- **Goal:** Free-text query in the drawer ("somewhere quiet that takes reservations and isn't pizza").
- **Hook:** A new `query?: string` field on `SuggestionContext`. When present, the pipeline routes through an LLM intent parser that maps to `categories`, `tags`, and `hardExclusions`.
- **Then** falls into the same rank engine — LLM only parses, doesn't rank in this step.
- **Dependency:** Anthropic API client; one new dep, gated behind a feature flag.

## Collaborative filtering
- **Goal:** "Circles similar to yours liked X."
- **Hook:** `pipeline/score.ts` introduces a new `collaborative` component (weight default 0).
- **Privacy guardrail:** Only circles that have opted in (admin toggle in `/c/[slug]/settings`) participate. Defaults to off; aggregates are k-anonymized (≥ 5 circles per group). This is the only piece that breaks the "circle-local signal only" v1 rule, and only with explicit consent.

## AI itinerary planning
- **Goal:** "Plan our Saturday — dinner + a movie + drinks."
- **Hook:** Builds **on top of** `getSuggestions`, not inside it. A new server action `getItinerary(input)` runs the existing pipeline once per leg (dinner / movie / drinks), then calls the Anthropic API to thread them into a narrative with constraints (driving time between legs, total budget).
- **Storage:** Multiple suggestion logs linked by a shared `itinerary_id` (new column on `suggestion_logs`).
- **UI:** A separate sheet variant; does not bloat the existing single-suggestion drawer.

## Autonomous planning
- **Goal:** Squad surfaces a complete plan ("Saturday 7pm, Bar Tartine, here's the invite") without anyone tapping **+ New plan**.
- **Hook:** A scheduled job (`supabase/functions/auto-plan-weekly/`) runs Friday morning, calls `getSuggestions` with the circle's typical pattern (`time_window` inferred from the most common day-of-week + hour for the circle's `plan_events.kind='created'`), and drafts a plan in `status='draft'` (new enum value) that requires one human tap to publish.
- **Guardrail:** Auto-published plans are explicitly opt-in per circle. Without consent, drafts are surfaced as a "Squad suggests" banner only.

## Per-user veto signals
- **Goal:** Capture individual "I don't eat seafood" without forcing it on the whole circle.
- **Hook:** Extend `circle_preference_signals.cohort` semantics: rows scoped to a single `userId` get OR-merged into the cohort-aggregate at read time. UI is a v2-only `/c/[slug]/you` panel.

## Booking integrations
- **Goal:** "Reserve" button on a restaurant card.
- **Hook:** A new optional `Activity.booking?: { provider: string; url: string }` field. Providers populate it where available; v1 simply ignores it.

## Quality loop ("rate the experience")
- **Goal:** Post-plan rating that feeds back into preference signals.
- **Hook:** A new `feedback` enum value `'rated_positive'|'rated_negative'` on `suggestion_log_items`. UI is a one-tap thumbs on the Receipt variant (M24) when a plan is `done`.

## What stays out, even in v2
- **No public discovery surface.** PLAN.md §12 privacy is load-bearing.
- **No third-party data sale or aggregated leaderboards.**
- **No prediction beyond "circles like yours" (CF) and the user's own circle.** No cross-user inference.
