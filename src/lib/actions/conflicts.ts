"use server";

import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  circles,
  memberships,
  planTimeProposals,
  plans,
  votes,
} from "@/db/schema";
import { ActionError } from "@/lib/actions/errors";
import { requireUserId } from "@/lib/auth";
import { circleDotClass } from "@/lib/circle-color";
import { overlaps } from "@/lib/conflicts-overlap";

// M32.2 — cross-circle commitment read used by the calendar (§3) and every
// conflict UX surface (§4). One commitment = one plan a given user is "on
// the hook for" inside the window. The shape of a commitment is the
// projection §7 / §2 calls out — circle id + display color + start/end +
// vote status + approximate flag — and nothing more; severity (hard vs
// soft) is the caller's call (CONVERGENCE_PLAN.md §2 Severity).
//
// Membership join (rather than a bare `votes.user_id = ?` filter) is the
// §9 "belt and braces" privacy guard: if a user is somehow voted into a
// plan in a circle they've since left, we still won't surface it.

export type CommitmentVote = "in" | "maybe" | "creator";

export type UserCommitment = {
  planId: string;
  planTitle: string;
  circleId: string;
  circleColor: string;
  start: Date;
  end: Date;
  vote: CommitmentVote;
  isApproximate: boolean;
};

export async function getUserCommitments(
  userId: string,
  fromUtc: Date,
  toUtc: Date,
): Promise<UserCommitment[]> {
  // `"use server"` exports are callable from any signed-in client, so a naked
  // `userId` parameter would let user A enumerate user B's commitments. Pin
  // the requester to the requested id; server-internal callers wanting to
  // query another user should route through a non-action helper instead.
  const requesterId = await requireUserId();
  if (requesterId !== userId) {
    throw new ActionError("FORBIDDEN", "Not your commitments.");
  }
  if (!(fromUtc instanceof Date) || !(toUtc instanceof Date)) {
    return [];
  }
  if (fromUtc >= toUtc) {
    return [];
  }

  // Range overlap pushed to SQL so the partial indexes from M32.1
  // (idx_plans_starts_at_status, idx_votes_user_status_in) carry the load.
  // plans.starts_at + (duration_minutes || ' minutes')::interval gives the
  // plan's computed end without a materialised column.
  const planEnd = sql<Date>`${plans.startsAt} + (${plans.durationMinutes} || ' minutes')::interval`;

  const rows = await db
    .select({
      planId: plans.id,
      planTitle: plans.title,
      circleId: plans.circleId,
      startsAt: plans.startsAt,
      endsAt: planEnd,
      voteStatus: votes.status,
      createdBy: plans.createdBy,
      isApproximate: plans.isApproximate,
    })
    .from(plans)
    .innerJoin(
      memberships,
      and(
        eq(memberships.circleId, plans.circleId),
        eq(memberships.userId, userId),
      ),
    )
    .leftJoin(
      votes,
      and(eq(votes.planId, plans.id), eq(votes.userId, userId)),
    )
    .where(
      and(
        inArray(plans.status, ["active", "confirmed"]),
        // Half-open overlap with the [fromUtc, toUtc) window. Mirrors the
        // pure overlap predicate in src/lib/conflicts-overlap.ts.
        sql`${plans.startsAt} < ${toUtc.toISOString()}::timestamptz`,
        sql`${planEnd} > ${fromUtc.toISOString()}::timestamptz`,
        // Commitment = in-vote OR maybe-vote OR creator. Auto-vote on
        // creation (PLAN.md §6 Flow C step 4) means creators usually have
        // an `in` row too — the OR covers the historical/legacy gap.
        or(
          inArray(votes.status, ["in", "maybe"]),
          eq(plans.createdBy, userId),
        ),
      ),
    );

  return rows.map((row) => {
    const vote: CommitmentVote =
      row.voteStatus === "in" || row.voteStatus === "maybe"
        ? row.voteStatus
        : "creator";
    return {
      planId: row.planId,
      planTitle: row.planTitle,
      circleId: row.circleId,
      circleColor: circleDotClass(row.circleId),
      start: row.startsAt,
      // drizzle returns the computed interval as a date string; normalise.
      end: row.endsAt instanceof Date ? row.endsAt : new Date(row.endsAt),
      vote,
      isApproximate: row.isApproximate,
    };
  });
}

// M32.3 — payload for <ConflictWarningSheet />. One conflicting commitment;
// the sheet only ever shows one card. Three-way conflicts fall back to "first
// match wins" per §8 ("Three-way conflicts. Detected and shown as multiple
// pairwise pushes; no special 3-way UI.").
export type VoteConflict = {
  planId: string;
  planTitle: string;
  circleId: string;
  circleSlug: string;
  circleName: string;
  circleColor: string;
  start: Date;
  end: Date;
  venue: string | null;
};

// Hard-only commitment query, scoped tightly enough to skip the broader
// calendar projection. Returns the first plan that overlaps the supplied
// window where the user is IN (vote='in' or creator auto-in) and the plan
// isn't approximate. Soft-conflict cases (MAYBE-side, approximate-side) are
// excluded — §2 severity ladder says soft conflicts never trigger the sheet.
async function findHardConflict(
  userId: string,
  excludePlanId: string,
  start: Date,
  end: Date,
): Promise<VoteConflict | null> {
  const planEnd = sql<Date>`${plans.startsAt} + (${plans.durationMinutes} || ' minutes')::interval`;

  const rows = await db
    .select({
      planId: plans.id,
      planTitle: plans.title,
      circleId: plans.circleId,
      circleSlug: circles.slug,
      circleName: circles.name,
      startsAt: plans.startsAt,
      endsAt: planEnd,
      location: plans.location,
    })
    .from(plans)
    .innerJoin(circles, eq(circles.id, plans.circleId))
    .innerJoin(
      memberships,
      and(
        eq(memberships.circleId, plans.circleId),
        eq(memberships.userId, userId),
      ),
    )
    .leftJoin(
      votes,
      and(eq(votes.planId, plans.id), eq(votes.userId, userId)),
    )
    .where(
      and(
        ne(plans.id, excludePlanId),
        inArray(plans.status, ["active", "confirmed"]),
        eq(plans.isApproximate, false),
        sql`${plans.startsAt} < ${end.toISOString()}::timestamptz`,
        sql`${planEnd} > ${start.toISOString()}::timestamptz`,
        or(eq(votes.status, "in"), eq(plans.createdBy, userId)),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    planId: row.planId,
    planTitle: row.planTitle,
    circleId: row.circleId,
    circleSlug: row.circleSlug,
    circleName: row.circleName,
    circleColor: circleDotClass(row.circleId),
    start: row.startsAt,
    end: row.endsAt instanceof Date ? row.endsAt : new Date(row.endsAt),
    venue: row.location,
  };
}

// Sheet trigger for Scenario 2 — user about to tap IN. Returns the
// conflicting commitment, or null when there's none (including approximate
// targets, which always degrade to a soft conflict).
export async function getConflictForVote(
  planId: string,
): Promise<VoteConflict | null> {
  const userId = await requireUserId();

  const plan = await db.query.plans.findFirst({
    columns: {
      id: true,
      circleId: true,
      startsAt: true,
      durationMinutes: true,
      isApproximate: true,
      status: true,
      timeMode: true,
    },
    where: eq(plans.id, planId),
  });
  if (!plan) return null;
  // Approximate plans never hard-conflict (§2 severity, scenario 9).
  // Open-mode plans haven't picked a time yet, so there's nothing concrete to
  // collide with.
  if (plan.isApproximate || plan.timeMode === "open") return null;
  if (plan.status !== "active" && plan.status !== "confirmed") return null;

  const start = plan.startsAt;
  const end = new Date(start.getTime() + plan.durationMinutes * 60_000);

  // Belt-and-braces overlap check in JS — keeps semantics in sync with
  // src/lib/conflicts-overlap.ts (the half-open predicate the tests pin).
  const hit = await findHardConflict(userId, planId, start, end);
  if (!hit) return null;
  if (!overlaps({ start, end }, { start: hit.start, end: hit.end })) return null;
  return hit;
}

// M32.4 — minimal shape for the conflict-dot decorations (Scenarios 3, 4,
// 5 visual). Less data than `VoteConflict` because the dot's tooltip only
// needs the plan title; circle metadata is reserved for the compare sheet.
export type MyHardCommitment = {
  planId: string;
  planTitle: string;
  circleName: string;
  start: Date;
  end: Date;
};

// Authed range query for dot decorations. Returns every hard commitment
// overlapping `[fromUtc, toUtc)` (IN-vote or creator auto-in on a non-
// approximate active/confirmed plan). `excludePlanId` skips the plan the
// user is currently interacting with so its own start_at doesn't paint a
// dot on its own time picker.
export async function getMyHardCommitmentsInRange(
  fromUtc: Date,
  toUtc: Date,
  excludePlanId?: string,
): Promise<MyHardCommitment[]> {
  const userId = await requireUserId();
  if (!(fromUtc instanceof Date) || !(toUtc instanceof Date)) return [];
  if (fromUtc >= toUtc) return [];

  const planEnd = sql<Date>`${plans.startsAt} + (${plans.durationMinutes} || ' minutes')::interval`;

  const conditions = [
    inArray(plans.status, ["active", "confirmed"]),
    eq(plans.isApproximate, false),
    sql`${plans.startsAt} < ${toUtc.toISOString()}::timestamptz`,
    sql`${planEnd} > ${fromUtc.toISOString()}::timestamptz`,
    or(eq(votes.status, "in"), eq(plans.createdBy, userId)),
  ];
  if (excludePlanId) conditions.push(ne(plans.id, excludePlanId));

  const rows = await db
    .select({
      planId: plans.id,
      planTitle: plans.title,
      circleName: circles.name,
      startsAt: plans.startsAt,
      endsAt: planEnd,
    })
    .from(plans)
    .innerJoin(circles, eq(circles.id, plans.circleId))
    .innerJoin(
      memberships,
      and(
        eq(memberships.circleId, plans.circleId),
        eq(memberships.userId, userId),
      ),
    )
    .leftJoin(
      votes,
      and(eq(votes.planId, plans.id), eq(votes.userId, userId)),
    )
    .where(and(...conditions));

  return rows.map((row) => ({
    planId: row.planId,
    planTitle: row.planTitle,
    circleName: row.circleName,
    start: row.startsAt,
    end: row.endsAt instanceof Date ? row.endsAt : new Date(row.endsAt),
  }));
}

// Sheet trigger for Scenario 5 — user about to tap a counter-proposal. The
// proposal's `starts_at` is the candidate lock time; we treat it as
// equivalent to committing to the parent plan at that time for conflict
// purposes. Same `replacement`/`addition` distinction as M24: only
// `replacement` proposals shift the canonical time, so additions never trip
// the sheet.
export async function getConflictForProposalVote(
  proposalId: string,
): Promise<VoteConflict | null> {
  const userId = await requireUserId();

  const proposal = await db.query.planTimeProposals.findFirst({
    columns: {
      id: true,
      planId: true,
      startsAt: true,
      kind: true,
    },
    where: eq(planTimeProposals.id, proposalId),
  });
  if (!proposal) return null;
  if (proposal.kind !== "replacement") return null;

  const plan = await db.query.plans.findFirst({
    columns: {
      id: true,
      durationMinutes: true,
      isApproximate: true,
      status: true,
    },
    where: eq(plans.id, proposal.planId),
  });
  if (!plan) return null;
  if (plan.isApproximate) return null;
  if (plan.status !== "active" && plan.status !== "confirmed") return null;

  const start = proposal.startsAt;
  const end = new Date(start.getTime() + plan.durationMinutes * 60_000);

  const hit = await findHardConflict(userId, proposal.planId, start, end);
  if (!hit) return null;
  if (!overlaps({ start, end }, { start: hit.start, end: hit.end })) return null;
  return hit;
}
