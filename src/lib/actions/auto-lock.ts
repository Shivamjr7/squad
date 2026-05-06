"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import {
  circles,
  planTimeProposalVotes,
  planTimeProposals,
  planVenueVotes,
  planVenues,
  plans,
  votes,
} from "@/db/schema";
import { sendPlanLockedEmail } from "@/lib/email";
import { getAppUrl } from "@/lib/url";
import { recordPlanEvent } from "@/lib/actions/plan-events";

// M22 auto-lock. The plan flips to `confirmed` when:
//   1. (regular path) `votes` with status = 'in' ≥ plans.lock_threshold AND a
//      single time proposal AND a single venue option each have unique
//      plurality, OR
//   2. (deadline path) the cron's `decide_by` reaper passes `force=true` so
//      the plurality requirement is relaxed — earliest-proposed wins on ties.
//
// Single source of truth so the in-app vote paths (M22) and the cron edge
// function call the same logic; the helper does not auth-check the caller —
// auth happens upstream.

type LockResult = {
  locked: boolean;
  // Set when this call performed the lock; useful to gate email sends and
  // revalidation so concurrent voters don't double-fire.
  lockedNow: boolean;
  // The canonical (startsAt, location) the plan was locked to. Null when not
  // locked.
  startsAt: Date | null;
  location: string | null;
};

export async function tryAutoLock(
  planId: string,
  opts: { force?: boolean } = {},
): Promise<LockResult> {
  const force = opts.force === true;

  const plan = await db.query.plans.findFirst({
    columns: {
      id: true,
      circleId: true,
      status: true,
      timeMode: true,
      startsAt: true,
      location: true,
      lockThreshold: true,
      decideBy: true,
    },
    where: eq(plans.id, planId),
  });
  if (!plan) {
    return { locked: false, lockedNow: false, startsAt: null, location: null };
  }
  // Open-mode plans lock via M20's slot-driven path; M22 only handles exact.
  if (plan.timeMode !== "exact") {
    return { locked: false, lockedNow: false, startsAt: null, location: null };
  }
  if (plan.status !== "active") {
    return { locked: false, lockedNow: false, startsAt: null, location: null };
  }

  // Threshold gate (regular path only). When forced (deadline reaper), we
  // lock with whatever's there, including zero `in` votes.
  if (!force) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(votes)
      .where(and(eq(votes.planId, planId), eq(votes.status, "in")));
    const inCount = Number(row?.n ?? 0);
    if (inCount < plan.lockThreshold) {
      return {
        locked: false,
        lockedNow: false,
        startsAt: null,
        location: null,
      };
    }
  }

  // ─── Resolve canonical time ───────────────────────────────────────────
  // No proposal rows → the original starts_at is the only candidate.
  // 1+ rows → tally votes, pick the leader. Force path breaks ties on
  // earliest-proposed (createdAt asc); regular path requires a unique leader
  // (otherwise we keep waiting for more votes).
  const proposalRows = await db
    .select({
      id: planTimeProposals.id,
      startsAt: planTimeProposals.startsAt,
      createdAt: planTimeProposals.createdAt,
    })
    .from(planTimeProposals)
    .where(eq(planTimeProposals.planId, planId))
    .orderBy(asc(planTimeProposals.createdAt));

  let canonicalStartsAt = plan.startsAt;
  if (proposalRows.length > 0) {
    const proposalCounts = await db
      .select({
        proposalId: planTimeProposalVotes.proposalId,
        n: sql<number>`count(*)::int`,
      })
      .from(planTimeProposalVotes)
      .innerJoin(
        planTimeProposals,
        eq(planTimeProposals.id, planTimeProposalVotes.proposalId),
      )
      .where(eq(planTimeProposals.planId, planId))
      .groupBy(planTimeProposalVotes.proposalId);

    const countMap = new Map<string, number>();
    for (const c of proposalCounts) {
      countMap.set(c.proposalId, Number(c.n));
    }

    let leader = proposalRows[0];
    let leaderVotes = countMap.get(leader.id) ?? 0;
    let tied = false;
    for (let i = 1; i < proposalRows.length; i++) {
      const p = proposalRows[i];
      const c = countMap.get(p.id) ?? 0;
      if (c > leaderVotes) {
        leader = p;
        leaderVotes = c;
        tied = false;
      } else if (c === leaderVotes && c > 0) {
        tied = true;
      }
    }
    if (!force && tied) {
      return {
        locked: false,
        lockedNow: false,
        startsAt: null,
        location: null,
      };
    }
    canonicalStartsAt = leader.startsAt;
  }

  // ─── Resolve canonical venue ──────────────────────────────────────────
  const venueRows = await db
    .select({
      id: planVenues.id,
      label: planVenues.label,
      createdAt: planVenues.createdAt,
    })
    .from(planVenues)
    .where(eq(planVenues.planId, planId))
    .orderBy(asc(planVenues.createdAt));

  let canonicalLocation = plan.location;
  if (venueRows.length > 0) {
    const venueCounts = await db
      .select({
        venueId: planVenueVotes.venueId,
        n: sql<number>`count(*)::int`,
      })
      .from(planVenueVotes)
      .innerJoin(planVenues, eq(planVenues.id, planVenueVotes.venueId))
      .where(eq(planVenues.planId, planId))
      .groupBy(planVenueVotes.venueId);

    const countMap = new Map<string, number>();
    for (const c of venueCounts) countMap.set(c.venueId, Number(c.n));

    let leader = venueRows[0];
    let leaderVotes = countMap.get(leader.id) ?? 0;
    let tied = false;
    for (let i = 1; i < venueRows.length; i++) {
      const v = venueRows[i];
      const c = countMap.get(v.id) ?? 0;
      if (c > leaderVotes) {
        leader = v;
        leaderVotes = c;
        tied = false;
      } else if (c === leaderVotes && c > 0) {
        tied = true;
      }
    }
    if (!force && tied) {
      return {
        locked: false,
        lockedNow: false,
        startsAt: null,
        location: null,
      };
    }
    canonicalLocation = leader.label;
  }

  // ─── Atomic flip ──────────────────────────────────────────────────────
  // Guard on status='active' so concurrent locks (two voters tipping the
  // threshold simultaneously) only succeed once. The losing call returns
  // lockedNow=false and skips the email.
  const updated = await db
    .update(plans)
    .set({
      status: "confirmed",
      startsAt: canonicalStartsAt,
      location: canonicalLocation,
    })
    .where(and(eq(plans.id, planId), eq(plans.status, "active")))
    .returning({ id: plans.id });

  if (updated.length === 0) {
    return {
      locked: true,
      lockedNow: false,
      startsAt: canonicalStartsAt,
      location: canonicalLocation,
    };
  }

  void recordPlanEvent({
    planId,
    userId: null, // system-driven lock
    kind: "locked",
    payload: {
      startsAt: canonicalStartsAt.toISOString(),
      location: canonicalLocation,
      forced: force,
    },
  });

  const circle = await db.query.circles.findFirst({
    columns: { slug: true },
    where: eq(circles.id, plan.circleId),
  });
  if (circle?.slug) {
    revalidatePath(`/c/${circle.slug}/p/${planId}`);
    revalidatePath(`/c/${circle.slug}`);
  }

  const appUrl = await getAppUrl();
  void sendPlanLockedEmail(planId, appUrl).catch((err) => {
    console.error("[auto-lock] email fanout failed", err);
  });

  return {
    locked: true,
    lockedNow: true,
    startsAt: canonicalStartsAt,
    location: canonicalLocation,
  };
}
