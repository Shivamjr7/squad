import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Enums ──────────────────────────────────────────────────────────────

export const membershipRole = pgEnum("membership_role", ["admin", "member"]);

// M30 — in-app notification types. M31 extends with plan_locked,
// plan_leave_soon, and plan_cancelled. `plan_reminder` is kept in the enum
// for backward compat with rows already in the table, but no new sites write
// it — `plan_leave_soon` replaces it as the pre-event nudge.
// M32 extends with plan_conflict / plan_conflict_resolved (cross-circle
// overlap notifications, see CONVERGENCE_PLAN.md §5).
// Add new kinds at the end — Postgres enums grow forward only.
export const notificationType = pgEnum("notification_type", [
  "vote_in",
  "plan_created",
  "plan_reminder",
  "plan_locked",
  "plan_leave_soon",
  "plan_cancelled",
  "plan_conflict",
  "plan_conflict_resolved",
]);

export const planType = pgEnum("plan_type", [
  "eat",
  "play",
  "chai",
  "stay-in",
  "other",
]);

export const planStatus = pgEnum("plan_status", [
  "active",
  "confirmed",
  "done",
  "cancelled",
]);

export const voteStatus = pgEnum("vote_status", ["in", "out", "maybe"]);

export const planTimeMode = pgEnum("plan_time_mode", ["exact", "open"]);

// M24 — `addition` = stacked sub-plan ("dinner after at Bar Tartine") that
// renders as a PLUS row on Variant B / AFTER row on Variant C, NOT a vote-
// candidate for the same slot. `replacement` is the M22 default — counter-
// proposes the canonical time.
export const proposalKind = pgEnum("proposal_kind", ["replacement", "addition"]);

// M24 — activity log kinds. Used by the Receipt variant to render a
// canonical timeline of what happened to the plan, in order.
// S7 — `suggestion_added` / `suggestion_rejected` close the suggest loop on
// the receipt timeline; payload carries `{ suggestionLogId, itemId }`.
export const planEventKind = pgEnum("plan_event_kind", [
  "created",
  "voted",
  "proposed_time",
  "proposed_venue",
  "added_member",
  "locked",
  "cancelled",
  "suggestion_added",
  "suggestion_rejected",
]);

// ─── Tables ─────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  hasSetDisplayName: boolean("has_set_display_name").notNull().default(false),
  // M31 — global mute. Defaults to true so new accounts are opted in at the
  // model level (NOTIFICATIONS_PLAN.md §1 principle 2). `resolvePlanAudience`
  // filters this server-side before any push dispatch. Flipped from /you →
  // Manage devices → "Mute all notifications".
  notificationsEnabled: boolean("notifications_enabled")
    .notNull()
    .default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

// M30 — Web Push subscriptions, one row per device. Supersedes the M26
// `users.push_subscription` jsonb column so the same user can receive pushes
// on phone + desktop simultaneously. Identity = `endpoint` (the push
// service's per-subscription URL); subscribe upserts on it, unsubscribe
// deletes by it. A 410 Gone response from the push service means delete that
// specific row only — never wipe other rows for the same user.
//
// M30 delivery: query all rows WHERE user_id = ? to fan out a notification
// to every registered device. A 410 Gone response from the push service
// means delete that specific endpoint row.
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    // "mobile" | "desktop" | null — sniffed from the user agent at subscribe
    // time so the You page can label which device a row came from.
    deviceHint: text("device_hint"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    endpointUnique: uniqueIndex("push_subscriptions_endpoint_unique").on(
      table.endpoint,
    ),
    userIdx: index("push_subscriptions_user_idx").on(table.userId),
  }),
);

// M30 — in-app notification feed. One row per recipient per event; the
// payload jsonb carries the kind-specific shape so the UI can render rich
// copy without re-querying. read_at flips when the user views the feed (or
// the bell). type-keyed payload examples:
//   vote_in       { planId, planTitle, circleSlug, voterName }
//   plan_created  { planId, planTitle, circleSlug, creatorName }
//   plan_reminder { planId, planTitle, circleSlug, startsAt, location }
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationType("type").notNull(),
    payload: jsonb("payload"),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Bell + feed both query "rows for user X, newest first" — composite
    // index keeps that path fast as the table grows.
    userCreatedIdx: index("notifications_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  }),
);

export const circles = pgTable(
  "circles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // Suggest Plan S1 — persistent "home area" used as circleCentroid fallback
    // when the user denies geolocation. All nullable / defaulted; existing
    // circles keep working with no centroid until an admin sets one.
    homeLocationText: text("home_location_text"),
    homeLat: doublePrecision("home_lat"),
    homeLng: doublePrecision("home_lng"),
    homeRadiusKm: integer("home_radius_km").notNull().default(5),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    slugUnique: uniqueIndex("circles_slug_unique").on(table.slug),
  }),
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userCircleUnique: uniqueIndex("memberships_user_circle_unique").on(
      table.userId,
      table.circleId,
    ),
    circleIdx: index("memberships_circle_id_idx").on(table.circleId),
  }),
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    codeUnique: uniqueIndex("invites_code_unique").on(table.code),
  }),
);

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    type: planType("type").notNull(),
    timeZone: text("time_zone").notNull().default("UTC"),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    timeMode: planTimeMode("time_mode").notNull().default("exact"),
    isApproximate: boolean("is_approximate").notNull().default(false),
    // M32 — codifies the implicit 2h end the ICS export already assumes
    // (`src/lib/calendar.ts`). Server-set; no creator UI in M32.
    durationMinutes: integer("duration_minutes").notNull().default(120),
    location: text("location"),
    maxPeople: integer("max_people"),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    status: planStatus("status").notNull().default("active"),
    cancelledAt: timestamp("cancelled_at", {
      withTimezone: true,
      mode: "date",
    }),
    reminderSentAt: timestamp("reminder_sent_at", {
      withTimezone: true,
      mode: "date",
    }),
    // M31 — set when the 45-min pre-leave push fires for a confirmed plan.
    // Gates the `remind-plans` edge function so the same plan can't re-push
    // on later cron ticks within the 40–50 min window.
    leavePushSentAt: timestamp("leave_push_sent_at", {
      withTimezone: true,
      mode: "date",
    }),
    decideBy: timestamp("decide_by", {
      withTimezone: true,
      mode: "date",
    }),
    // M22 — auto-lock threshold. Plan flips to `confirmed` when this many `in`
    // votes have converged on a single time + venue. Stored per-plan so
    // settings can later expose a circle-level default.
    lockThreshold: integer("lock_threshold").notNull().default(5),
    // UI Phase 7 — optional one-word "vibe" the creator can attach to a
    // plan (Chill / Hype / Quick / Cosy / Late, plus free text). Capped
    // at 12 chars at the form layer; column is plain text so the cap can
    // evolve without a migration.
    vibe: text("vibe"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    circleIdx: index("plans_circle_id_idx").on(table.circleId),
    circleStartsIdx: index("plans_circle_starts_idx").on(
      table.circleId,
      table.startsAt,
    ),
    // M32 — powers `getUserCommitments(userId, range)` (the calendar's hot
    // query). Partial index keeps only live plans; cancelled/done are skipped.
    startsAtStatusIdx: index("idx_plans_starts_at_status")
      .on(table.startsAt)
      .where(sql`${table.status} IN ('active', 'confirmed')`),
  }),
);

export const votes = pgTable(
  "votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: voteStatus("status").notNull(),
    votedAt: timestamp("voted_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    planUserUnique: uniqueIndex("votes_plan_user_unique").on(
      table.planId,
      table.userId,
    ),
    // Squad Pulse + Activity by user — votes_plan_user_unique leads on plan_id,
    // so a user-only filter falls back to seq scan without this.
    userIdx: index("votes_user_id_idx").on(table.userId),
    // Index for joining votes with plans in activity queries
    planIdx: index("votes_plan_id_idx").on(table.planId),
    // M32 — calendar's per-user commitment scan filters to in/maybe rows.
    // Partial index trims out the OUT votes (the dominant status long-term).
    userStatusInIdx: index("idx_votes_user_status_in")
      .on(table.userId, table.status)
      .where(sql`${table.status} IN ('in', 'maybe')`),
  }),
);

// M32 — conflict-notification ledger. Records that we sent a `plan_conflict`
// push for the (user, plan_a, plan_b) triple so the matching
// `plan_conflict_resolved` push (when one plan is cancelled / vote flipped /
// time moved away) only fires if the original ever shipped. CHECK enforces
// canonical pair order so the unique key collapses (A,B) and (B,A) into one
// row — same convention used by the OS notification tag in
// CONVERGENCE_PLAN.md §5.
export const conflictNotifications = pgTable(
  "conflict_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planAId: uuid("plan_a_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    planBId: uuid("plan_b_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    sentAt: timestamp("sent_at", { mode: "date" }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { mode: "date" }),
  },
  (table) => ({
    userPairUnique: uniqueIndex("conflict_notifications_user_pair_unique").on(
      table.userId,
      table.planAId,
      table.planBId,
    ),
    canonicalPairCheck: check(
      "conflict_notifications_canonical_pair_check",
      sql`${table.planAId} < ${table.planBId}`,
    ),
  }),
);

export const timeSlots = pgTable(
  "time_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" })
      .notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    planIdx: index("time_slots_plan_id_idx").on(table.planId),
  }),
);

export const timeSlotVotes = pgTable(
  "time_slot_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => timeSlots.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    votedAt: timestamp("voted_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    slotUserUnique: uniqueIndex("time_slot_votes_slot_user_unique").on(
      table.slotId,
      table.userId,
    ),
  }),
);

export const planVenues = pgTable(
  "plan_venues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    suggestedBy: text("suggested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // Suggest Plan S1 — provenance + provider link. `source='suggestion'`
    // lights up the sparkle marker on the venue chip and ties the row back
    // into suggestion_log_items for won/cancelled feedback writes (S7).
    source: text("source").notNull().default("manual"),
    suggestionItemId: uuid("suggestion_item_id").references(
      () => suggestionLogItems.id,
      { onDelete: "set null" },
    ),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    externalGeo: jsonb("external_geo").$type<{ lat: number; lng: number } | null>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    planIdx: index("plan_venues_plan_id_idx").on(table.planId),
  }),
);

export const planVenueVotes = pgTable(
  "plan_venue_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => planVenues.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    votedAt: timestamp("voted_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    venueUserUnique: uniqueIndex("plan_venue_votes_venue_user_unique").on(
      table.venueId,
      table.userId,
    ),
  }),
);

export const planTimeProposals = pgTable(
  "plan_time_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    proposedBy: text("proposed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // M24 — see proposalKind enum. Existing M22 rows back-fill to
    // `replacement` via the column default.
    kind: proposalKind("kind").notNull().default("replacement"),
    // M24 — only meaningful for kind=addition; carries the sub-plan's
    // description ("Dinner after at Bar Tartine"). Null for replacements.
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    planIdx: index("plan_time_proposals_plan_id_idx").on(table.planId),
  }),
);

export const planTimeProposalVotes = pgTable(
  "plan_time_proposal_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => planTimeProposals.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    votedAt: timestamp("voted_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    proposalUserUnique: uniqueIndex(
      "plan_time_proposal_votes_proposal_user_unique",
    ).on(table.proposalId, table.userId),
  }),
);

// M24 — append-only activity log used by the Receipt variant. payload is
// kind-specific JSON (e.g. {"vote": "in"}, {"time": "8:30 PM"}). The user_id
// nullifies on user delete because the receipt is historical truth — we want
// the row to survive even if the actor's account is gone.
export const planEvents = pgTable(
  "plan_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    kind: planEventKind("kind").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    planCreatedAt: index("plan_events_plan_created_at_idx").on(
      table.planId,
      table.createdAt,
    ),
  }),
);

// M23 — per-plan recipient set. Empty set for a plan = full circle (this is
// the back-compat path for plans created before M23, and the convention
// "ALL" in the chip picker writes no rows). Otherwise, only listed users are
// fan-out targets, see plans on home, and can vote.
export const planRecipients = pgTable(
  "plan_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    planUserUnique: uniqueIndex("plan_recipients_plan_user_unique").on(
      table.planId,
      table.userId,
    ),
    // Recipient EXISTS / NOT EXISTS subquery on home + my-plans visibility.
    planIdx: index("plan_recipients_plan_id_idx").on(table.planId),
  }),
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    planIdx: index("comments_plan_id_idx").on(table.planId),
  }),
);

// ─── Suggest Plan (S1) ──────────────────────────────────────────────────

// Aggregated taste / behavior signal per circle. Source of truth for the
// `GroupPreferenceProfile` view in the suggestion pipeline. Updated lazily —
// not real-time. `weight` is stored scaled ×1000 so we can keep it as an
// indexable int while preserving 3-decimal precision (range ±1000 for
// affinities, 0..1000 for recency).
export const circlePreferenceSignals = pgTable(
  "circle_preference_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    signalKind: text("signal_kind").notNull(),
    signalKey: text("signal_key").notNull(),
    weight: integer("weight").notNull(),
    cohort: jsonb("cohort").$type<string[] | null>(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    kindKeyUnique: uniqueIndex("circle_pref_kind_key_idx").on(
      table.circleId,
      table.signalKind,
      table.signalKey,
    ),
  }),
);

// One row per getSuggestions call. Full reproducibility — the stored context
// snapshot lets us re-rank offline without re-hitting providers. PII is
// scrubbed before insert (lat/lng → geohash-6) in the pipeline; this table
// trusts that contract.
export const suggestionLogs = pgTable(
  "suggestion_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    circleId: uuid("circle_id")
      .notNull()
      .references(() => circles.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Set lazily when a plan is eventually created from the suggestion. Plan
    // deletion nullifies (not cascades) so feedback history survives.
    planId: uuid("plan_id").references(() => plans.id, { onDelete: "set null" }),
    requestNonce: uuid("request_nonce").notNull(),
    context: jsonb("context").notNull(),
    weights: jsonb("weights").notNull(),
    degraded: jsonb("degraded"),
    outcome: text("outcome").notNull().default("served"),
    generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userNonceUnique: uniqueIndex("suggestion_logs_user_nonce_unique").on(
      table.userId,
      table.requestNonce,
    ),
    circleCreatedIdx: index("suggestion_logs_circle_created_idx").on(
      table.circleId,
      table.generatedAt,
    ),
  }),
);

// One row per surfaced result. `score` is stored scaled ×1000 to match
// `circle_preference_signals.weight`.
export const suggestionLogItems = pgTable(
  "suggestion_log_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    logId: uuid("log_id")
      .notNull()
      .references(() => suggestionLogs.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    activity: jsonb("activity").notNull(),
    breakdown: jsonb("breakdown").notNull(),
    score: integer("score").notNull(),
    // 'add' | 'reject' | 'refresh' | 'won' | 'cancelled'
    feedback: text("feedback"),
    feedbackAt: timestamp("feedback_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => ({
    logRankIdx: index("suggestion_log_items_log_rank_idx").on(
      table.logId,
      table.rank,
    ),
    feedbackIdx: index("suggestion_log_items_feedback_idx").on(table.feedback),
  }),
);

// Provider response cache. `key` is sha256(provider + canonical(input)).
// `value` stores the normalized payload only — never raw provider JSON.
// `metadata` carries the coarse daily call counter used for cost capping.
export const providerCache = pgTable(
  "provider_cache",
  {
    key: text("key").primaryKey(),
    provider: text("provider").notNull(),
    value: jsonb("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    expiresIdx: index("provider_cache_expires_idx").on(table.expiresAt),
  }),
);

// Sliding-window rate-limit counter. One row per (action, identity) key
// (e.g. "vote:user_abc"); window_start advances when the helper detects
// the previous window has elapsed. See src/lib/rate-limit.ts.
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    count: integer("count").notNull().default(0),
  },
  (table) => ({
    windowIdx: index("rate_limits_window_idx").on(table.windowStart),
  }),
);

// Idempotency log for incoming webhooks (currently Clerk via Svix).
// Svix verifies the signature and rejects payloads outside ±5min, but a
// replayed payload within that window with a valid signature would still
// re-fire DB writes. Inserting the svix-id as PK before the handler runs
// turns "duplicate within window" into a unique-constraint violation we
// can swallow as a no-op.
export const webhookEvents = pgTable(
  "webhook_events",
  {
    svixId: text("svix_id").primaryKey(),
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    receivedIdx: index("webhook_events_received_idx").on(table.receivedAt),
  }),
);

// ─── Relations ──────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  votes: many(votes),
  comments: many(comments),
  invites: many(invites),
  createdPlans: many(plans),
  createdCircles: many(circles),
  pushSubscriptions: many(pushSubscriptions),
  notifications: many(notifications),
}));

export const pushSubscriptionsRelations = relations(
  pushSubscriptions,
  ({ one }) => ({
    user: one(users, {
      fields: [pushSubscriptions.userId],
      references: [users.id],
    }),
  }),
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const circlesRelations = relations(circles, ({ one, many }) => ({
  creator: one(users, {
    fields: [circles.createdBy],
    references: [users.id],
  }),
  memberships: many(memberships),
  invites: many(invites),
  plans: many(plans),
  preferenceSignals: many(circlePreferenceSignals),
  suggestionLogs: many(suggestionLogs),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id],
  }),
  circle: one(circles, {
    fields: [memberships.circleId],
    references: [circles.id],
  }),
}));

export const invitesRelations = relations(invites, ({ one }) => ({
  circle: one(circles, {
    fields: [invites.circleId],
    references: [circles.id],
  }),
  creator: one(users, {
    fields: [invites.createdBy],
    references: [users.id],
  }),
}));

export const plansRelations = relations(plans, ({ one, many }) => ({
  circle: one(circles, {
    fields: [plans.circleId],
    references: [circles.id],
  }),
  creator: one(users, {
    fields: [plans.createdBy],
    references: [users.id],
  }),
  votes: many(votes),
  comments: many(comments),
  timeSlots: many(timeSlots),
  venues: many(planVenues),
  timeProposals: many(planTimeProposals),
  recipients: many(planRecipients),
  events: many(planEvents),
}));

export const planEventsRelations = relations(planEvents, ({ one }) => ({
  plan: one(plans, {
    fields: [planEvents.planId],
    references: [plans.id],
  }),
  user: one(users, {
    fields: [planEvents.userId],
    references: [users.id],
  }),
}));

export const planRecipientsRelations = relations(planRecipients, ({ one }) => ({
  plan: one(plans, {
    fields: [planRecipients.planId],
    references: [plans.id],
  }),
  user: one(users, {
    fields: [planRecipients.userId],
    references: [users.id],
  }),
}));

export const planVenuesRelations = relations(planVenues, ({ one, many }) => ({
  plan: one(plans, {
    fields: [planVenues.planId],
    references: [plans.id],
  }),
  suggester: one(users, {
    fields: [planVenues.suggestedBy],
    references: [users.id],
  }),
  votes: many(planVenueVotes),
  suggestionItem: one(suggestionLogItems, {
    fields: [planVenues.suggestionItemId],
    references: [suggestionLogItems.id],
  }),
}));

export const planVenueVotesRelations = relations(planVenueVotes, ({ one }) => ({
  venue: one(planVenues, {
    fields: [planVenueVotes.venueId],
    references: [planVenues.id],
  }),
  user: one(users, {
    fields: [planVenueVotes.userId],
    references: [users.id],
  }),
}));

export const planTimeProposalsRelations = relations(
  planTimeProposals,
  ({ one, many }) => ({
    plan: one(plans, {
      fields: [planTimeProposals.planId],
      references: [plans.id],
    }),
    proposer: one(users, {
      fields: [planTimeProposals.proposedBy],
      references: [users.id],
    }),
    votes: many(planTimeProposalVotes),
  }),
);

export const planTimeProposalVotesRelations = relations(
  planTimeProposalVotes,
  ({ one }) => ({
    proposal: one(planTimeProposals, {
      fields: [planTimeProposalVotes.proposalId],
      references: [planTimeProposals.id],
    }),
    user: one(users, {
      fields: [planTimeProposalVotes.userId],
      references: [users.id],
    }),
  }),
);

export const timeSlotsRelations = relations(timeSlots, ({ one, many }) => ({
  plan: one(plans, {
    fields: [timeSlots.planId],
    references: [plans.id],
  }),
  votes: many(timeSlotVotes),
}));

export const timeSlotVotesRelations = relations(timeSlotVotes, ({ one }) => ({
  slot: one(timeSlots, {
    fields: [timeSlotVotes.slotId],
    references: [timeSlots.id],
  }),
  user: one(users, {
    fields: [timeSlotVotes.userId],
    references: [users.id],
  }),
}));

export const votesRelations = relations(votes, ({ one }) => ({
  plan: one(plans, {
    fields: [votes.planId],
    references: [plans.id],
  }),
  user: one(users, {
    fields: [votes.userId],
    references: [users.id],
  }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  plan: one(plans, {
    fields: [comments.planId],
    references: [plans.id],
  }),
  user: one(users, {
    fields: [comments.userId],
    references: [users.id],
  }),
}));

export const circlePreferenceSignalsRelations = relations(
  circlePreferenceSignals,
  ({ one }) => ({
    circle: one(circles, {
      fields: [circlePreferenceSignals.circleId],
      references: [circles.id],
    }),
  }),
);

export const suggestionLogsRelations = relations(
  suggestionLogs,
  ({ one, many }) => ({
    circle: one(circles, {
      fields: [suggestionLogs.circleId],
      references: [circles.id],
    }),
    user: one(users, {
      fields: [suggestionLogs.userId],
      references: [users.id],
    }),
    plan: one(plans, {
      fields: [suggestionLogs.planId],
      references: [plans.id],
    }),
    items: many(suggestionLogItems),
  }),
);

export const suggestionLogItemsRelations = relations(
  suggestionLogItems,
  ({ one }) => ({
    log: one(suggestionLogs, {
      fields: [suggestionLogItems.logId],
      references: [suggestionLogs.id],
    }),
  }),
);
