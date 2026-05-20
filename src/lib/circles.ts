import { unstable_cache as cache } from "next/cache";
import { and, asc, desc, eq, gte, inArray, max, ne, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, memberships, plans, users, votes } from "@/db/schema";

// Per-circle activity counts surfaced on the cross-circle home cards so
// each circle row signals what's live, not just who's in it.
export type CircleActivity = {
  deciding: number;
  locked: number;
  // Active plans where this user hasn't voted yet AND can see the plan
  // (recipient or admin). Drives the coral status dot on the card.
  needsVote: number;
};
import type { KnownSquadUser, UserCircle } from "@/lib/circle-types";

export type { KnownSquadUser, UserCircle };

// Broad cache tags. `unstable_cache` requires tags to be static at
// definition time, so we can't scope per-entity. Writes invalidate the
// whole bucket — fine because membership / circle writes are rare, and the
// alternative (waiting out the revalidate window) was already stale.
export const CIRCLE_TAGS = {
  userCircles: "user-circles",
  circleBySlug: "circle-by-slug",
  circleMembers: "circle-members",
  circleActivity: "circle-activity",
} as const;

// Hot path — called by every authenticated server page (layout + page in the
// shell tree). `unstable_cache()` is cross-request: same args → cached result
// with a revalidation window, so repeated navigations avoid DB work.
export const getUserCircles = cache(
  async function getUserCircles(userId: string): Promise<UserCircle[]> {
  const rows = await db
    .select({
      id: circles.id,
      name: circles.name,
      slug: circles.slug,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(circles, eq(memberships.circleId, circles.id))
    .where(eq(memberships.userId, userId))
    .orderBy(desc(memberships.joinedAt));

  // Get member counts in a separate query to avoid expensive subquery per row
  const circleIds = rows.map(r => r.id);
  const memberCounts = circleIds.length > 0 
    ? await db
        .select({
          circleId: memberships.circleId,
          count: sql<number>`count(*)::int`,
        })
        .from(memberships)
        .where(inArray(memberships.circleId, circleIds))
        .groupBy(memberships.circleId)
    : [];

  const countMap = new Map(memberCounts.map(m => [m.circleId, m.count]));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    role: r.role,
    memberCount: countMap.get(r.id) || 0,
  }));
}, undefined, { revalidate: 60, tags: [CIRCLE_TAGS.userCircles] });

// Request-scoped circle lookup by slug. Layout + page + plan-detail all need
// this; `cache()` keeps it to a single DB roundtrip per render.
// One-shot activity summary for the cross-circle home cards. Aggregates
// per-circle counts in a single grouped query — three FILTER clauses
// over the same plan rows, no per-circle round-trip. Honors plan
// visibility: members only see plans where they're in the recipient
// set (or no recipients are configured), but adminCircleIds bypass
// that filter since admins always see every plan in their circle.
//
// Not cached: deciding / needsVote shift on every vote, so a 60s cache
// would read stale on the home page while the per-circle page is up to
// date. The query is one indexed scan; cheap enough for every render.
export async function getUserCirclesActivity(
  userId: string,
  circleIds: string[],
  adminCircleIds: string[],
): Promise<Map<string, CircleActivity>> {
  if (circleIds.length === 0) return new Map();

  const now = new Date();

  // Admin override: in circles where the user is admin, every plan is
  // visible regardless of recipient restrictions. Members fall through
  // to the recipient check.
  const adminFilter =
    adminCircleIds.length > 0
      ? inArray(plans.circleId, adminCircleIds)
      : sql`FALSE`;

  const visibilityFilter = or(
    adminFilter,
    sql`NOT EXISTS (SELECT 1 FROM plan_recipients pr WHERE pr.plan_id = ${plans.id})`,
    sql`EXISTS (SELECT 1 FROM plan_recipients pr WHERE pr.plan_id = ${plans.id} AND pr.user_id = ${userId})`,
  );

  const rows = await db
    .select({
      circleId: plans.circleId,
      deciding: sql<number>`COUNT(*) FILTER (WHERE ${plans.status} = 'active')::int`,
      locked: sql<number>`COUNT(*) FILTER (WHERE ${plans.status} = 'confirmed')::int`,
      needsVote: sql<number>`COUNT(*) FILTER (
        WHERE ${plans.status} = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM votes v
          WHERE v.plan_id = ${plans.id} AND v.user_id = ${userId}
        )
      )::int`,
    })
    .from(plans)
    .where(
      and(
        inArray(plans.circleId, circleIds),
        gte(plans.startsAt, now),
        visibilityFilter,
      ),
    )
    .groupBy(plans.circleId);

  const map = new Map<string, CircleActivity>();
  for (const r of rows) {
    map.set(r.circleId, {
      deciding: Number(r.deciding ?? 0),
      locked: Number(r.locked ?? 0),
      needsVote: Number(r.needsVote ?? 0),
    });
  }
  return map;
}

export const getCircleBySlug = cache(
  async function getCircleBySlug(slug: string) {
    return db.query.circles.findFirst({
      columns: { id: true, name: true, slug: true },
      where: eq(circles.slug, slug),
    });
  }, undefined, { revalidate: 300, tags: [CIRCLE_TAGS.circleBySlug] });

export type CircleMemberRow = {
  userId: string;
  role: "admin" | "member";
  joinedAt: Date;
  user: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
};

// Members + user join — used by the shell layout AND most pages.
export const getCircleMembers = cache(
  async function getCircleMembers(circleId: string): Promise<CircleMemberRow[]> {
    const rows = await db.query.memberships.findMany({
      where: eq(memberships.circleId, circleId),
      orderBy: asc(memberships.joinedAt),
      with: {
        user: { columns: { id: true, displayName: true, avatarUrl: true } },
      },
    });
    return rows.map((r) => ({
      userId: r.userId,
      role: r.role,
      joinedAt: r.joinedAt,
      user: r.user
        ? {
            id: r.user.id,
            displayName: r.user.displayName,
            avatarUrl: r.user.avatarUrl,
          }
        : null,
    }));
  }, undefined, { revalidate: 60, tags: [CIRCLE_TAGS.circleMembers] });

// Squad Pulse activity — last vote-or-plan-creation per member, scoped to a
// circle. Shell layout + home page both compute this from the same rows; the
// cache keeps it to one pair of queries per render.
export const getCircleMemberActivity = cache(
  async function getCircleMemberActivity(circleId: string): Promise<Record<string, string>> {
    const memberRows = await getCircleMembers(circleId);
    const memberIds = memberRows
      .map((m) => m.user?.id)
      .filter((id): id is string => Boolean(id));
    if (memberIds.length === 0) return {};

  const [voteActivity, planActivity] = await Promise.all([
    db
      .select({ userId: votes.userId, at: max(votes.votedAt) })
      .from(votes)
      .innerJoin(plans, eq(votes.planId, plans.id))
      .where(
        and(eq(plans.circleId, circleId), inArray(votes.userId, memberIds)),
      )
      .groupBy(votes.userId),
    db
      .select({ userId: plans.createdBy, at: max(plans.createdAt) })
      .from(plans)
      .where(
        and(
          eq(plans.circleId, circleId),
          inArray(plans.createdBy, memberIds),
        ),
      )
      .groupBy(plans.createdBy),
  ]);

    const lastActiveByUser = new Map<string, Date>();
    for (const r of voteActivity) {
      if (!r.userId || !r.at) continue;
      const prev = lastActiveByUser.get(r.userId);
      if (!prev || r.at > prev) lastActiveByUser.set(r.userId, r.at);
    }
    for (const r of planActivity) {
      if (!r.userId || !r.at) continue;
      const prev = lastActiveByUser.get(r.userId);
      if (!prev || r.at > prev) lastActiveByUser.set(r.userId, r.at);
    }

    const result: Record<string, string> = {};
    for (const [userId, date] of lastActiveByUser.entries()) {
      result[userId] = date.toISOString();
    }
    return result;
  }, undefined, { revalidate: 30, tags: [CIRCLE_TAGS.circleActivity] });

// Returns Squad users the caller already shares at least one circle with,
// excluding themselves and anyone already in `targetCircleId`.
export async function getKnownSquadUsers(
  currentUserId: string,
  targetCircleId: string,
): Promise<KnownSquadUser[]> {
  const myCircleRows = await db
    .select({ circleId: memberships.circleId })
    .from(memberships)
    .where(eq(memberships.userId, currentUserId));
  const myCircleIds = myCircleRows.map((r) => r.circleId);
  if (myCircleIds.length === 0) return [];

  const alreadyInTarget = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.circleId, targetCircleId));
  const excludeIds = alreadyInTarget.map((r) => r.userId);

  const rows = await db
    .selectDistinct({
      id: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(
      and(
        inArray(memberships.circleId, myCircleIds),
        ne(users.id, currentUserId),
        excludeIds.length > 0 ? notInArray(users.id, excludeIds) : undefined,
      ),
    )
    .orderBy(users.displayName);

  return rows;
}
