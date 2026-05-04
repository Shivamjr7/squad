import { and, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, memberships, users } from "@/db/schema";

export type UserCircle = {
  id: string;
  name: string;
  slug: string;
  role: "admin" | "member";
  memberCount: number;
};

export async function getUserCircles(userId: string): Promise<UserCircle[]> {
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
}

export type KnownSquadUser = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

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
