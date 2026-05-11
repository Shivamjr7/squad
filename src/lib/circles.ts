import { cache } from "react";
import { and, asc, desc, eq, inArray, max, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, memberships, plans, users, votes } from "@/db/schema";
import type { KnownSquadUser, UserCircle } from "@/lib/circle-types";

export type { KnownSquadUser, UserCircle };

// Hot path — called by every authenticated server page (layout + page in the
// shell tree). `cache()` is request-scoped: same args → same Promise, no
// duplicate DB roundtrips when layout + page both ask.
export const getUserCircles = cache(async function getUserCircles(
  userId: string,
): Promise<UserCircle[]> {
  const rows = await db
    .select({
      id: circles.id,
      name: circles.name,
      slug: circles.slug,
      role: memberships.role,
      memberCount: sql<number>`(
        select count(*)::int
        from ${memberships} m2
        where m2.circle_id = ${circles.id}
      )`,
    })
    .from(memberships)
    .innerJoin(circles, eq(memberships.circleId, circles.id))
    .where(eq(memberships.userId, userId))
    .orderBy(desc(memberships.joinedAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    role: r.role,
    memberCount: Number(r.memberCount),
  }));
});

// Request-scoped circle lookup by slug. Layout + page + plan-detail all need
// this; `cache()` keeps it to a single DB roundtrip per render.
export const getCircleBySlug = cache(async function getCircleBySlug(
  slug: string,
) {
  return db.query.circles.findFirst({
    columns: { id: true, name: true, slug: true },
    where: eq(circles.slug, slug),
  });
});

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
export const getCircleMembers = cache(async function getCircleMembers(
  circleId: string,
): Promise<CircleMemberRow[]> {
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
});

// Squad Pulse activity — last vote-or-plan-creation per member, scoped to a
// circle. Shell layout + home page both compute this from the same rows; the
// cache keeps it to one pair of queries per render.
export const getCircleMemberActivity = cache(async function getCircleMemberActivity(
  circleId: string,
): Promise<Map<string, Date>> {
  const memberRows = await getCircleMembers(circleId);
  const memberIds = memberRows
    .map((m) => m.user?.id)
    .filter((id): id is string => Boolean(id));
  if (memberIds.length === 0) return new Map();

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
  return lastActiveByUser;
});

// Returns Squad users the caller already shares at least one circle with,
// excluding themselves and anyone already in `targetCircleId`. Powers the
// "Add directly" list in the invite dialog (M17 Fix 3).
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
