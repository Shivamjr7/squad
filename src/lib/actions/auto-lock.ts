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
  suggestionLogItems,
  votes,
} from "@/db/schema";
import { recordPlanEvent } from "@/lib/actions/plan-events";
import {
  detectAndNotifyConflictsForAudience,
  reevaluateConflictsForPlan,
} from "@/lib/actions/conflict-notify";
import { resolvePlanAudience } from "@/lib/notifications";
import { dispatchPlanLockedNotification } from "@/lib/actions/plan-lock-notifications";

// Auto-lock. The plan flips to `confirmed` when `votes` with status='in'
// reach plans.lock_threshold AND a single time proposal AND a single venue
// option each have unique plurality.
//
// A fully-voted plan with fewer than lock_threshold IN votes stays active
// until enough people are actually in or a creator/admin locks it manually. That keeps
// "1 in + 1 maybe" from looking like consensus in a 2-person plan.
//
// Single source of truth so the in-app vote paths and the cron edge function
// call the same logic; the helper does not auth-check the caller — auth
// happens upstream.

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
  // Drives the lock event payload so M30 / the activity log can tell which
  // gate fired. Starts as `forced` when callers pass force=true (deadline
  // reaper); in-app paths default to `threshold`.
  const trigger: "threshold" | "forced" | "all_voted" = force
    ? "forced"
    : "threshold";

  const plan = await db.query.plans.findFirst({
    columns: {
      id: true,
      circleId: true,
      status: true,
      timeMode: true,
      startsAt: true,
      timeZone: true,
      location: true,
      lockThreshold: true,
      decideBy: true,
    },
    where: eq(plans.id, planId),
  });
  if (!plan) {
    return { locked: false, lockedNow: false, startsAt: null, location: null };
  }
  // Open-mode plans lock via M20's slot-driven path; this helper only handles
  // exact-time plans.
  if (plan.timeMode !== "exact") {
    return { locked: false, lockedNow: false, startsAt: null, location: null };
  }
  if (plan.status !== "active") {
    return { locked: false, lockedNow: false, startsAt: null, location: null };
  }

  // Gate selection. When forced (deadline reaper/manual caller) we skip the
  // threshold check. In the regular in-app path the plan needs enough IN
  // votes; Maybe/Out responses are signal, not consensus.
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
    .where(
      and(
        eq(planTimeProposals.planId, planId),
        eq(planTimeProposals.kind, "replacement"),
      ),
    )
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
      .where(
        and(
          eq(planTimeProposals.planId, planId),
          eq(planTimeProposals.kind, "replacement"),
        ),
      )
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
      source: planVenues.source,
      suggestionItemId: planVenues.suggestionItemId,
    })
    .from(planVenues)
    .where(eq(planVenues.planId, planId))
    .orderBy(asc(planVenues.createdAt));

  let canonicalLocation = plan.location;
  // S7 — track the winning venue row across the if-block so the post-flip
  // hook can write feedback='won' on its suggestion item. Single-venue
  // (plans.location-only) plans leave this null and skip the hook.
  let winningVenue: (typeof venueRows)[number] | null = null;
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
    winningVenue = leader;
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
      trigger,
    },
  });

  // S7 — if the winning venue came from a suggestion, close the loop on
  // the corresponding suggestion_log_item. Best-effort: a failed write
  // must not break the lock-confirmation fanout below.
  if (winningVenue?.source === "suggestion" && winningVenue.suggestionItemId) {
    const itemId = winningVenue.suggestionItemId;
    void (async () => {
      try {
        await db
          .update(suggestionLogItems)
          .set({ feedback: "won", feedbackAt: new Date() })
          .where(eq(suggestionLogItems.id, itemId));
      } catch (err) {
        console.error("[auto-lock] suggestion feedback=won failed", err);
      }
    })();
  }

  const circle = await db.query.circles.findFirst({
    columns: { slug: true, name: true },
    where: eq(circles.id, plan.circleId),
  });
  if (circle?.slug) {
    revalidatePath(`/c/${circle.slug}/p/${planId}`);
    revalidatePath(`/c/${circle.slug}`);
    revalidatePath(`/c/${circle.slug}/plans`);
  }
  // Cross-circle home shows the `deciding` / `locked` counts on each
  // circle card — bust its router cache too so a lock flips the labels
  // without needing a hard refresh.
  revalidatePath("/");

  // M31.6 — fire-and-forget "It's happening" push. System-driven from this
  // function's perspective: no actor exclusion, so the voter who tipped the
  // threshold also gets the push. That's intentional — confirms their vote
  // landed and gives a fast path back to the plan detail.
  if (circle) {
    void dispatchPlanLockedNotification({
      planId,
      circleId: plan.circleId,
      circleSlug: circle.slug,
      circleName: circle.name,
      startsAt: canonicalStartsAt,
      timeZone: plan.timeZone,
      location: canonicalLocation,
      trigger,
    });
  }

  // M32.7 — lock fan-out has two halves. Re-evaluation runs first because
  // the canonical starts_at may have shifted via a counter-proposal (M22),
  // so prior ledger rows that paired this plan with someone's other plan
  // could now be stale. After that, detection re-runs across the full
  // audience to catch new collisions the shifted window introduced
  // (scenario 8). Both are fire-and-forget so a slow ledger query never
  // blocks the lock path.
  void (async () => {
    try {
      await reevaluateConflictsForPlan(planId);
      const audience = await resolvePlanAudience(planId, plan.circleId, null);
      await detectAndNotifyConflictsForAudience(planId, audience);
    } catch (err) {
      console.error("[auto-lock] conflict reconcile failed", {
        planId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return {
    locked: true,
    lockedNow: true,
    startsAt: canonicalStartsAt,
    location: canonicalLocation,
  };
}
