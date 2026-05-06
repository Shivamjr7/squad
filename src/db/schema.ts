import { relations } from "drizzle-orm";
import {
  boolean,
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
export const planEventKind = pgEnum("plan_event_kind", [
  "created",
  "voted",
  "proposed_time",
  "proposed_venue",
  "added_member",
  "locked",
  "cancelled",
]);

// ─── Tables ─────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  hasSetDisplayName: boolean("has_set_display_name").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const circles = pgTable(
  "circles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
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

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  circleId: uuid("circle_id")
    .notNull()
    .references(() => circles.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  type: planType("type").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
  timeMode: planTimeMode("time_mode").notNull().default("exact"),
  isApproximate: boolean("is_approximate").notNull().default(false),
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
  decideBy: timestamp("decide_by", {
    withTimezone: true,
    mode: "date",
  }),
  // M22 — auto-lock threshold. Plan flips to `confirmed` when this many `in`
  // votes have converged on a single time + venue. Stored per-plan so
  // settings can later expose a circle-level default.
  lockThreshold: integer("lock_threshold").notNull().default(5),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

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
  }),
);

export const timeSlots = pgTable("time_slots", {
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
});

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

export const planVenues = pgTable("plan_venues", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  suggestedBy: text("suggested_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

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

export const planTimeProposals = pgTable("plan_time_proposals", {
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
});

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
  }),
);

export const comments = pgTable("comments", {
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
});

// ─── Relations ──────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  votes: many(votes),
  comments: many(comments),
  invites: many(invites),
  createdPlans: many(plans),
  createdCircles: many(circles),
}));

export const circlesRelations = relations(circles, ({ one, many }) => ({
  creator: one(users, {
    fields: [circles.createdBy],
    references: [users.id],
  }),
  memberships: many(memberships),
  invites: many(invites),
  plans: many(plans),
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
