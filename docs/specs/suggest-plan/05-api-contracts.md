# 05 — API Contracts

## Conventions inherited from Squad
- Server Actions for mutations / context-aware reads where the new-plan sheet is the only caller.
- Route handlers under `src/app/api/*` only when called from non-form contexts (cron, ICS, webhooks) — pattern already used by `/api/plans/[planId]/ics` and `/api/webhooks`.
- All inputs validated by zod (`src/lib/validation/suggest.ts`). Action errors use the existing `ActionError` shape from `src/lib/actions/errors.ts`.
- All actions auth-gated via `requireMembership(circleId)`.

## Server Actions

### `getSuggestions(input: GetSuggestionsInput): Promise<GetSuggestionsResult>`
**File:** `src/lib/actions/suggest-plan.ts`
**Caller:** Suggest drawer inside `components/plan/new-plan-form.tsx`.

```ts
const getSuggestionsSchema = z.object({
  circleId: z.string().uuid(),
  planType: z.enum(['eat','play','chai','stay-in','other']),
  timeMode: z.enum(['exact','open']),
  startsAtLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/),
  timeZone: z.string().min(1),
  isApproximate: z.boolean(),
  geo: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyMeters: z.number().nonnegative().optional(),
  }).optional(),
  distanceKmCap: z.number().min(0.5).max(100).optional(),
  budgetTier: z.enum(['$','$$','$$$']).optional(),
  excludeIds: z.array(z.string()).max(50).default([]),
  recipientUserIds: z.array(z.string()).max(200).default([]),
  limit: z.number().int().min(1).max(10).default(5),
  requestNonce: z.string().uuid(),
});

type GetSuggestionsInput = z.infer<typeof getSuggestionsSchema>;
type GetSuggestionsResult = RecommendationResult;
```

**Errors (`ActionError.code`):**
- `UNAUTHORIZED` — not signed in
- `FORBIDDEN` — not a member of `circleId`
- `INVALID` — zod failure
- `RATE_LIMITED` — > 20 req / min / user
- `PROVIDERS_DOWN` — *all* category providers + weather failed; returns 200 with `degraded[]` and empty `results` rather than throwing (the drawer needs the log id to record the empty event).

### `recordFeedback(input: RecordFeedbackInput): Promise<{ ok: true }>`
**File:** `src/lib/actions/suggest-plan.ts`

```ts
const recordFeedbackSchema = z.object({
  suggestionLogId: z.string().uuid(),
  itemId: z.string().uuid(),
  feedback: z.enum(['add','reject','refresh']),
});
```
- `won` and `cancelled` feedback are written **by the server** in:
  - `auto-lock.ts` after `captureWinningVenue` succeeds with a venue that has `source='suggestion'`.
  - `plans.ts` `cancelPlan` when any attached venue is from a suggestion.
  Never written from the client.

### `getCirclePreferences(circleId): Promise<GroupPreferenceProfile>`
Internal-only — not exported as a server action. Used by the pipeline + future settings page.

## Route handlers (none new for v1)
No new `/api/*` routes. Suggest lives entirely behind server actions because:
- It's only ever called from inside an authenticated React form.
- Cron-style refreshes are not needed (lazy on user tap).
- Future integrations (e.g. a WhatsApp bot, see PLAN.md §13) would justify a public `/api/suggest` later; deferred.

## Pagination
- Not paginated. `limit` ≤ 10. "Refresh" replaces, doesn't append.
- `excludeIds` is the only continuation mechanism.

## Filtering behavior (client-driver vs. server-driver)
- Client may send `distanceKmCap` and `budgetTier`; server validates + clamps.
- Hard filters (membership scope, opening hours, weather penalties) are server-only and not client-overridable.
- `excludeIds` only **soft-suppresses** — providers may still return the id; the pipeline removes it server-side.

## Caching
- **Provider cache** (Postgres, table `provider_cache` — see `09-data-model.md`): key = `(provider, hash(input))`, TTL 30 min for places, 15 min for weather, 6 h for movies/events list.
- **Group preference cache** (in-memory LRU, 15 min TTL, key = `circleId+cohort`). Wiped on any new `plan_event` of kind `voted` or `proposed_venue` via existing realtime broadcast.
- **No CDN caching** — all responses `Cache-Control: private, no-store`.

## Realtime
- No realtime subscriptions for v1 suggestions. The drawer is single-user; refreshes are explicit. Avoids fan-out cost.
- Once the user **adds** a suggestion to `plan_venues`, the existing `use-venue-votes.tsx` realtime channel propagates it like any manual venue.

## Idempotency
- `requestNonce` (uuid v4 from client) is stored on `suggestion_logs` with a unique index `(user_id, request_nonce)`. Re-submission within 5s of the same nonce returns the **same** result (read from log) rather than re-running providers.
