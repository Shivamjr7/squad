# 02 — User Flows

Naming matches PLAN.md §6 (Flow A, B, …). New flows are **G**, **H**, **I**.

## Flow G — Suggest while creating a plan (happy path)
1. User taps **+ New plan** on `/c/[slug]` (existing sticky CTA, M19 sheet).
2. User picks **WHAT** (type chip) — e.g. *Eat*.
3. User picks **WHEN** (date/time or "Open — squad picks") — establishes time window.
4. In the **WHERE** block, user taps a new **✨ Suggest** button next to "Add another option."
5. A suggestion drawer slides up (full-screen on mobile, side panel on `md:`).
   - Shows 3–5 cards: name, category icon, distance, ~price tier, one-line explanation ("Cafe • 4 min walk • good for chai · open till 11pm").
   - Each card has **Add** and **Skip** affordances.
6. User taps **Add** on 1–N cards → they appear in the WHERE list as locked chips with a small ✨ marker.
7. User submits the plan as usual. Selected suggestions are written as `plan_venues` rows with `source='suggestion'` and a foreign-key reference into `suggestion_logs`.

## Flow H — Refresh / "show me different ones"
1. From the drawer in Flow G, user taps **🔄 Refresh** in the header.
2. The previously-shown set is recorded as `ignored` for this circle/plan window (telemetry only — not a hard exclusion).
3. A new fetch runs with `excludeIds = previousResultIds`. If providers can't surface fresh results, the drawer shows "That's everything nearby — try widening the area" + a "Widen to 5 km" CTA.
4. Tap **Widen** → re-runs with `distanceKmCap` bumped one tier (1 → 3 → 5 → 10), capped.

## Flow I — Reject a single suggestion
1. From a suggestion card, user taps the small **✕** corner (long-press on mobile is too hidden — explicit tap target).
2. Card swipes out optimistically; row is replaced by the next backfill candidate, kept in the local pool.
3. Server records a `feedback = 'reject'` event tied to the `suggestion_log` row. No second prompt — the optimistic UX rule from PLAN.md §8 holds.

## Edge flows

### Flow G-edge-1 — Geolocation denied or unavailable
- Show suggestions ranked by **circle centroid** (set when the circle picks a "home" location during onboarding or first plan) with no walking-time field.
- Walking-time hint hidden, not replaced with a fake value.
- If circle has no centroid yet → drawer shows a one-time "Set your circle's home area" prompt that pre-fills `circles.home_location_text`. Skipping means the drawer falls back to global ranking (events/movies first, then anything with a price tier).

### Flow G-edge-2 — Weather provider down
- Outdoor candidates are not boosted/penalized; the "good weather" explanation line is silently omitted. Pipeline still ships ranked results.

### Flow G-edge-3 — All providers down
- Drawer collapses to a single "Suggest isn't reachable right now — type a venue instead" empty state, with a **Try again** chip. Does NOT block plan creation.

### Flow G-edge-4 — Recipients restrict the audience
- Suggestion context inherits the in-flight `recipientUserIds` so preference signals are aggregated over that subset, not the full circle (mirrors M23 `plan_recipients` semantics).

### Flow G-edge-5 — Approximate / open-mode plans
- `time_mode = 'open'` → context uses the **midpoint of the slot range** (M20 default 6–11 PM) as the anchor time.
- `is_approximate = true` → time window expands to day-bucket; opening-hours filter loosens to "any hours that day."

### Flow H-edge-1 — Empty pool
- After refresh and widen, if still empty: drawer shows "Nothing fits these filters" + a CTA back to manual entry. We log this as `outcome = 'empty'` on the suggestion log.

## Implicit signals captured during flows
| Action | Signal stored |
|---|---|
| Drawer opens | `impression_set` (one row per suggestion) |
| **Add** tap | `feedback = 'add'` |
| **Skip** card (passive) | nothing |
| **✕** tap | `feedback = 'reject'` |
| **Refresh** | `feedback = 'refresh'` on each surfaced row |
| Plan locks with a suggested venue winning | `feedback = 'won'` (set by the M22 auto-lock job) |
| Plan cancelled w/ suggested venue still attached | `feedback = 'cancelled'` (set by `cancelPlan`) |
