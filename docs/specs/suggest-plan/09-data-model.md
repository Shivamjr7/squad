# 09 — Data Model

## Conventions
- Drizzle ORM, same patterns as `src/db/schema.ts` (snake_case columns, uuid PKs, `timestamp({ withTimezone: true, mode: "date" })`).
- All changes are **additive** — no edits to existing columns. Migrations land via `drizzle-kit generate`.
- **PLAN.md §5 must be amended before** any schema change is merged (CLAUDE.md rule).

## New tables

### `circle_preference_signals`
Aggregated taste / behavior signal per circle. Source of truth for `GroupPreferenceProfile`. Updated on `plan_venue` writes, vote events, and post-lock outcomes.
```ts
export const circlePreferenceSignals = pgTable("circle_preference_signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  circleId: uuid("circle_id").notNull()
    .references(() => circles.id, { onDelete: "cascade" }),
  // 'cuisine' | 'category' | 'price' | 'recent_venue' | 'hard_exclusion'
  signalKind: text("signal_kind").notNull(),
  // signal-kind-specific key, e.g. 'south_indian', 'cafe', '$$', venue label
  signalKey: text("signal_key").notNull(),
  // -1..1 for affinities, 0..1 for recency
  weight: integer("weight").notNull(),  // stored as int * 1000 for precision; convert in app
  /** subset of users this signal aggregates over; null = whole circle */
  cohort: jsonb("cohort").$type<string[] | null>(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull().defaultNow(),
}, (t) => ({
  circleKindKeyIdx: uniqueIndex("circle_pref_kind_key_idx")
    .on(t.circleId, t.signalKind, t.signalKey),
}));
```
- ON DELETE CASCADE on circle: signals don't survive deletion.
- Recomputed lazily; not real-time.

### `suggestion_logs`
One row per `getSuggestions` call. Full reproducibility.
```ts
export const suggestionLogs = pgTable("suggestion_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  circleId: uuid("circle_id").notNull()
    .references(() => circles.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "set null" }),
  /** if the plan was eventually created, link back */
  planId: uuid("plan_id")
    .references(() => plans.id, { onDelete: "set null" }),
  requestNonce: uuid("request_nonce").notNull(),
  /** PII-scrubbed SuggestionContext snapshot — lat/lng → geohash6 */
  context: jsonb("context").notNull(),
  weights: jsonb("weights").notNull(),
  degraded: jsonb("degraded"),
  /** 'served' | 'refreshed' | 'empty' | 'errored' */
  outcome: text("outcome").notNull().default("served"),
  generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" })
    .notNull().defaultNow(),
}, (t) => ({
  userNonceUnique: uniqueIndex("suggestion_logs_user_nonce_unique")
    .on(t.userId, t.requestNonce),
  circleCreatedIdx: index("suggestion_logs_circle_created_idx")
    .on(t.circleId, t.generatedAt),
}));
```

### `suggestion_log_items`
One row per surfaced result.
```ts
export const suggestionLogItems = pgTable("suggestion_log_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  logId: uuid("log_id").notNull()
    .references(() => suggestionLogs.id, { onDelete: "cascade" }),
  rank: integer("rank").notNull(),       // 1..limit
  activity: jsonb("activity").notNull(), // normalized Activity
  breakdown: jsonb("breakdown").notNull(),
  score: integer("score").notNull(),     // 0..1000 (int for indexability)
  /** 'add'|'reject'|'refresh'|'won'|'cancelled'|null */
  feedback: text("feedback"),
  feedbackAt: timestamp("feedback_at", { withTimezone: true, mode: "date" }),
}, (t) => ({
  logRankIdx: index("suggestion_log_items_log_rank_idx")
    .on(t.logId, t.rank),
  feedbackIdx: index("suggestion_log_items_feedback_idx").on(t.feedback),
}));
```

### `provider_cache`
Keyed cache for provider responses + a coarse daily call counter.
```ts
export const providerCache = pgTable("provider_cache", {
  key: text("key").primaryKey(),         // sha256
  provider: text("provider").notNull(),
  value: jsonb("value").notNull(),       // Activity[] or WeatherSnapshot
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
    .notNull(),
  metadata: jsonb("metadata"),           // { dailyCount, day }
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull().defaultNow(),
}, (t) => ({
  expiresIdx: index("provider_cache_expires_idx").on(t.expiresAt),
}));
```
A daily pg_cron (`vacuum-provider-cache`) deletes expired rows, mirroring the M15 pg_cron pattern.

## New columns on existing tables

### `circles`
Augment with persistent geo + radius for the circle's "home" area.
```ts
homeLocationText: text("home_location_text"),     // human label
homeLat:          doublePrecision("home_lat"),    // null = no centroid yet
homeLng:          doublePrecision("home_lng"),
homeRadiusKm:     integer("home_radius_km").notNull().default(5),
```
- All nullable / default — back-compat for existing circles.
- Editable in `/c/[slug]/settings` (admin only) — UI to be added in the implementation phase, but column lands in M-suggest-1.

### `plan_venues`
Track venue provenance.
```ts
source:           text("source").notNull().default("manual"), // 'manual' | 'suggestion'
suggestionItemId: uuid("suggestion_item_id")
                    .references(() => suggestionLogItems.id, { onDelete: "set null" }),
externalId:       text("external_id"),       // e.g. 'gp:ChIJ…' for re-link
externalUrl:      text("external_url"),
externalGeo:      jsonb("external_geo"),      // { lat, lng }
```
- All nullable except `source`. `source = 'suggestion'` lights up the ✨ marker on the venue chip + on the plan-detail venue card.
- `suggestionItemId` is what closes the loop for `won`/`cancelled` feedback writes.

## Indexes
Listed inline above. Critical ones:
- `suggestion_logs_user_nonce_unique` — idempotency.
- `suggestion_logs_circle_created_idx` — analytics queries per circle.
- `suggestion_log_items_feedback_idx` — feedback-rate dashboards.
- `provider_cache_expires_idx` — vacuum scan.

## Analytics / event tracking
- `suggestion_log_items.feedback` is the canonical signal.
- `plan_events.kind` extended with two values: `'suggestion_added'`, `'suggestion_rejected'`. Both append rows with `payload = { suggestionLogId, itemId }`. This re-uses the M24 audit-log surface — the **Receipt** variant on plan detail will automatically show suggestion-related events.
- Vercel Web Analytics custom events:
  - `suggest_open` — drawer opens
  - `suggest_add` — user adds a result
  - `suggest_refresh` — refresh tap
  - `suggest_empty` — empty pool
- No third-party analytics; respects PLAN.md §12 privacy constraints.

## Future extensibility
- `circle_preference_signals.signalKind` is text, not an enum, so adding new signals (e.g. `noise_level`, `accessibility`) is a code-only change.
- `suggestion_log_items.activity` is `jsonb` so new optional Activity fields don't require migrations.
- Embeddings (v2): a separate `activity_embeddings` table keyed by `activity.id` can be added without touching this schema.

## Cascade summary (additions to PLAN.md §5 cascade summary)
- Deleting a **circle** cascades to: `circle_preference_signals`, `suggestion_logs` (via FK), and through logs to `suggestion_log_items`.
- Deleting a **plan** does not cascade `suggestion_logs.planId` — it nullifies, preserving feedback history (mirror of `plans.createdBy` semantics).
- Deleting a **user** nullifies `suggestion_logs.userId`; the signal aggregation already excludes deleted users via cohort filtering at read time.
