import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
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

// ─── Tables ─────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
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
