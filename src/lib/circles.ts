import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, memberships } from "@/db/schema";

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
