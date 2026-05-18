"use server";

import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, memberships, plans, users } from "@/db/schema";
import { requireUserId } from "@/lib/auth";

// Cross-scope search powering the Cmd-K palette. Returns up to N matches
// per group, scoped to entities the requesting user can actually access.
// - circles: any circle the user is a member of, name ILIKE %q%
// - plans:   any plan in those circles where the user is a recipient,
//            title ILIKE %q%, plus a small recency bias
// - members: any user who shares at least one circle with the requester,
//            displayName ILIKE %q%
//
// Everything else (suggest API, notifications, etc.) is intentionally out
// of scope — search is for navigation, not for content discovery. Adding
// other entities risks bloating the result list past usefulness.

export type SearchPlanHit = {
  kind: "plan";
  id: string;
  title: string;
  circleSlug: string;
  circleName: string;
  startsAt: string; // ISO
  status: "active" | "confirmed" | "done" | "cancelled";
};

export type SearchCircleHit = {
  kind: "circle";
  id: string;
  slug: string;
  name: string;
  memberCount: number;
};

export type SearchMemberHit = {
  kind: "member";
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  // The slug of *one* shared circle — used to deep-link to that circle's
  // Squad page (members live per-circle, so we need a slug to route to).
  sharedCircleSlug: string;
};

export type SearchResult = {
  plans: SearchPlanHit[];
  circles: SearchCircleHit[];
  members: SearchMemberHit[];
};

const PER_GROUP_LIMIT = 6;
const MIN_QUERY_LEN = 1;

const EMPTY: SearchResult = { plans: [], circles: [], members: [] };

export async function searchUserScope(
  query: string,
): Promise<SearchResult> {
  const userId = await requireUserId();
  const q = query.trim();
  if (q.length < MIN_QUERY_LEN) return EMPTY;
  // SQL ILIKE pattern — escape % and _ so a user's literal "_" doesn't act
  // as a wildcard. Cheap; called once per palette keystroke.
  const safe = q.replace(/[%_]/g, (m) => `\\${m}`);
  const pattern = `%${safe}%`;

  // Resolve the user's circle membership once — every group queries from
  // within this set so an admin in circle A can't enumerate B's members.
  const myCircles = await db
    .select({ id: memberships.circleId })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  const circleIds = myCircles.map((r) => r.id);
  if (circleIds.length === 0) return EMPTY;

  const [planRows, circleRows, memberRows] = await Promise.all([
    db
      .select({
        id: plans.id,
        title: plans.title,
        startsAt: plans.startsAt,
        status: plans.status,
        circleId: plans.circleId,
        circleSlug: circles.slug,
        circleName: circles.name,
      })
      .from(plans)
      .innerJoin(circles, eq(circles.id, plans.circleId))
      .where(
        and(
          inArray(plans.circleId, circleIds),
          ilike(plans.title, pattern),
          // Same recipient-visibility rule used elsewhere: implicit full-
          // circle OR explicit recipient OR creator. Keeps an admin from
          // seeing a plan that excluded them.
          or(
            sql`NOT EXISTS (SELECT 1 FROM plan_recipients pr WHERE pr.plan_id = ${plans.id})`,
            sql`EXISTS (SELECT 1 FROM plan_recipients pr WHERE pr.plan_id = ${plans.id} AND pr.user_id = ${userId})`,
            eq(plans.createdBy, userId),
          ),
        ),
      )
      // Soft recency bias: upcoming first, then most recent past.
      .orderBy(desc(plans.startsAt))
      .limit(PER_GROUP_LIMIT),

    db
      .select({
        id: circles.id,
        slug: circles.slug,
        name: circles.name,
      })
      .from(circles)
      .where(and(inArray(circles.id, circleIds), ilike(circles.name, pattern)))
      .orderBy(asc(circles.name))
      .limit(PER_GROUP_LIMIT),

    db
      .selectDistinctOn([users.id], {
        userId: users.id,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        circleId: memberships.circleId,
        circleSlug: circles.slug,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(circles, eq(circles.id, memberships.circleId))
      .where(
        and(
          inArray(memberships.circleId, circleIds),
          ilike(users.displayName, pattern),
        ),
      )
      .orderBy(users.id)
      .limit(PER_GROUP_LIMIT),
  ]);

  // Member-count enrichment in one round-trip so the circle rows can
  // render "2 people" inline. Single GROUP BY query.
  const circleHitIds = circleRows.map((r) => r.id);
  const counts =
    circleHitIds.length === 0
      ? []
      : await db
          .select({
            circleId: memberships.circleId,
            n: sql<number>`count(*)::int`,
          })
          .from(memberships)
          .where(inArray(memberships.circleId, circleHitIds))
          .groupBy(memberships.circleId);
  const countByCircle = new Map(counts.map((c) => [c.circleId, c.n]));

  return {
    plans: planRows.map((r) => ({
      kind: "plan",
      id: r.id,
      title: r.title,
      circleSlug: r.circleSlug,
      circleName: r.circleName,
      startsAt: r.startsAt.toISOString(),
      status: r.status,
    })),
    circles: circleRows.map((r) => ({
      kind: "circle",
      id: r.id,
      slug: r.slug,
      name: r.name,
      memberCount: countByCircle.get(r.id) ?? 0,
    })),
    members: memberRows.map((r) => ({
      kind: "member",
      userId: r.userId,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl,
      sharedCircleSlug: r.circleSlug,
    })),
  };
}
