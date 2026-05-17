// Server-internal — called from other server actions (castVote, createPlan,
// markPlanDone, cancelPlan, tryAutoLock). Deliberately NOT a "use server"
// module: no client surface for these, since fanning out conflict pushes
// for an arbitrary user/plan pair isn't something a client should request.
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  circles,
  conflictNotifications,
  memberships,
  plans,
  votes,
} from "@/db/schema";
import { overlaps } from "@/lib/conflicts-overlap";
import { dispatchNotifications } from "@/lib/notifications";

// M32.7 — conflict push dispatcher + ledger. Two write paths:
//
//   1. Detection — when a plan window first contains a hard conflict for
//      some user, write a ledger row and dispatch `plan_conflict`. Per
//      CONVERGENCE_PLAN.md §5 the ledger UNIQUE (user_id, plan_a_id,
//      plan_b_id) is what guarantees "same pair never re-fires" — even if
//      callers re-detect on every interaction, the INSERT ... ON CONFLICT
//      DO NOTHING returns an empty set on the second call so nothing
//      dispatches.
//
//   2. Resolution — when the conflict goes away (vote walks back, plan
//      gets cancelled, time shifts out of the window), mark `resolved_at`
//      and dispatch `plan_conflict_resolved` if the original push went
//      out within the last 7 days. Older conflicts resolve silently —
//      the user already moved on.
//
// The ledger CHECK constraint forces plan_a_id < plan_b_id; we always
// canonical-sort before the insert so the OS tag (also canonical-sorted)
// stays in sync with the row.

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Type used to model both sides of a pair when assembling a push payload.
// Same shape on each side — the "anchor" / "other" distinction is a caller
// concern, not a data one.
type PlanForPayload = {
  planId: string;
  planTitle: string;
  circleSlug: string;
  circleName: string;
};

type LoadedPlan = {
  id: string;
  circleId: string;
  startsAt: Date;
  durationMinutes: number;
  isApproximate: boolean;
  status: "active" | "confirmed" | "done" | "cancelled";
  timeMode: "exact" | "open";
  title: string;
  circleSlug: string;
  circleName: string;
};

async function loadPlanWithCircle(planId: string): Promise<LoadedPlan | null> {
  const rows = await db
    .select({
      id: plans.id,
      circleId: plans.circleId,
      startsAt: plans.startsAt,
      durationMinutes: plans.durationMinutes,
      isApproximate: plans.isApproximate,
      status: plans.status,
      timeMode: plans.timeMode,
      title: plans.title,
      circleSlug: circles.slug,
      circleName: circles.name,
    })
    .from(plans)
    .innerJoin(circles, eq(circles.id, plans.circleId))
    .where(eq(plans.id, planId))
    .limit(1);
  return rows[0] ?? null;
}

function planIsCommitmentEligible(p: LoadedPlan): boolean {
  // §2: hard conflicts only fire on non-approximate, exact-time, in-flight
  // plans. Cancelled / done plans aren't commitments anymore (scenario 10).
  if (p.isApproximate) return false;
  if (p.timeMode !== "exact") return false;
  if (p.status !== "active" && p.status !== "confirmed") return false;
  return true;
}

// Find every other plan the user is hard-committed to (IN vote or creator
// auto-in) that overlaps `[start, end)`. Membership join doubles as the §9
// privacy guard — we never return a plan from a circle the user has since
// left.
async function findOverlappingHardCommitments(
  userId: string,
  excludePlanId: string,
  start: Date,
  end: Date,
): Promise<PlanForPayload[]> {
  const planEnd = sql<Date>`${plans.startsAt} + (${plans.durationMinutes} || ' minutes')::interval`;

  const rows = await db
    .select({
      planId: plans.id,
      planTitle: plans.title,
      circleSlug: circles.slug,
      circleName: circles.name,
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
        eq(plans.timeMode, "exact"),
        sql`${plans.startsAt} < ${end.toISOString()}::timestamptz`,
        sql`${planEnd} > ${start.toISOString()}::timestamptz`,
        or(eq(votes.status, "in"), eq(plans.createdBy, userId)),
      ),
    );

  return rows;
}

// Insert a ledger row for the (user, planA, planB) triple in canonical
// order. Returns the inserted row, or `null` when the ON CONFLICT path was
// taken — i.e. the pair already had a push and shouldn't fire again.
async function insertLedgerIfMissing(
  userId: string,
  pairA: string,
  pairB: string,
): Promise<{ id: string } | null> {
  const [planAId, planBId] = pairA < pairB ? [pairA, pairB] : [pairB, pairA];
  const inserted = await db
    .insert(conflictNotifications)
    .values({ userId, planAId, planBId })
    .onConflictDoNothing()
    .returning({ id: conflictNotifications.id });
  return inserted[0] ?? null;
}

// Build + send a single `plan_conflict` push. `anchor` is the plan whose
// change just triggered detection (the click destination); `other` is the
// existing commitment that now collides.
async function dispatchConflictPush(
  userId: string,
  anchor: PlanForPayload,
  other: PlanForPayload,
): Promise<void> {
  await dispatchNotifications({
    type: "plan_conflict",
    userIds: [userId],
    payload: {
      recipientUserId: userId,
      planId: anchor.planId,
      planTitle: anchor.planTitle,
      circleSlug: anchor.circleSlug,
      circleName: anchor.circleName,
      otherPlanId: other.planId,
      otherPlanTitle: other.planTitle,
      otherCircleName: other.circleName,
    },
  });
}

async function dispatchResolvedPush(
  userId: string,
  anchor: PlanForPayload,
  other: PlanForPayload,
): Promise<void> {
  await dispatchNotifications({
    type: "plan_conflict_resolved",
    userIds: [userId],
    payload: {
      recipientUserId: userId,
      planId: anchor.planId,
      planTitle: anchor.planTitle,
      circleSlug: anchor.circleSlug,
      circleName: anchor.circleName,
      otherPlanId: other.planId,
      otherPlanTitle: other.planTitle,
      otherCircleName: other.circleName,
    },
  });
}

// Public — fired from castVote on the IN edge. Detects whether the user's
// fresh IN on `planId` produces a new hard conflict with any of their
// other commitments, and pushes per pair.
export async function detectAndNotifyConflictsForUserPlan(
  userId: string,
  planId: string,
): Promise<void> {
  const plan = await loadPlanWithCircle(planId);
  if (!plan || !planIsCommitmentEligible(plan)) return;
  await runDetectionForUser(plan, userId);
}

// Public — fired from createPlan + auto-lock. Each audience member is
// checked individually for an existing commitment overlapping the new plan
// window (createPlan: anchor is the newly-created plan; auto-lock: anchor
// is the just-locked plan, possibly at a shifted starts_at).
export async function detectAndNotifyConflictsForAudience(
  planId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const plan = await loadPlanWithCircle(planId);
  if (!plan || !planIsCommitmentEligible(plan)) return;
  for (const userId of userIds) {
    try {
      await runDetectionForUser(plan, userId);
    } catch (err) {
      // One bad row should never take down the rest of the fanout.
      console.error("[conflict-notify] per-user detection failed", {
        userId,
        planId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function runDetectionForUser(
  plan: LoadedPlan,
  userId: string,
): Promise<void> {
  const start = plan.startsAt;
  const end = new Date(start.getTime() + plan.durationMinutes * 60_000);

  const matches = await findOverlappingHardCommitments(
    userId,
    plan.id,
    start,
    end,
  );

  const anchor: PlanForPayload = {
    planId: plan.id,
    planTitle: plan.title,
    circleSlug: plan.circleSlug,
    circleName: plan.circleName,
  };

  for (const other of matches) {
    const inserted = await insertLedgerIfMissing(userId, plan.id, other.planId);
    if (!inserted) continue; // pair already pushed — never re-fire
    await dispatchConflictPush(userId, anchor, other);
  }
}

// Public — fired when the user's vote walks back from IN. Resolves every
// ledger row of the (user, planId) pair that's still open.
export async function resolveConflictsForUserOnPlan(
  userId: string,
  planId: string,
): Promise<void> {
  const rows = await db
    .select({
      id: conflictNotifications.id,
      planAId: conflictNotifications.planAId,
      planBId: conflictNotifications.planBId,
      sentAt: conflictNotifications.sentAt,
    })
    .from(conflictNotifications)
    .where(
      and(
        eq(conflictNotifications.userId, userId),
        or(
          eq(conflictNotifications.planAId, planId),
          eq(conflictNotifications.planBId, planId),
        ),
        isNull(conflictNotifications.resolvedAt),
      ),
    );

  if (rows.length === 0) return;
  await resolveRowsAndPush(userId, planId, rows);
}

// Public — fired from cancelPlan + markPlanDone. Plan is no longer hard-
// commitment-eligible, so every open ledger row involving it resolves.
export async function resolveAllConflictsForPlan(
  planId: string,
): Promise<void> {
  const rows = await db
    .select({
      id: conflictNotifications.id,
      userId: conflictNotifications.userId,
      planAId: conflictNotifications.planAId,
      planBId: conflictNotifications.planBId,
      sentAt: conflictNotifications.sentAt,
    })
    .from(conflictNotifications)
    .where(
      and(
        or(
          eq(conflictNotifications.planAId, planId),
          eq(conflictNotifications.planBId, planId),
        ),
        isNull(conflictNotifications.resolvedAt),
      ),
    );

  if (rows.length === 0) return;
  // Group by user so we can amortise the per-user push dispatch — the row
  // count per plan-cancel is small in practice (friend-group scale).
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byUser.get(r.userId) ?? [];
    list.push(r);
    byUser.set(r.userId, list);
  }

  for (const [userId, userRows] of byUser.entries()) {
    try {
      await resolveRowsAndPush(userId, planId, userRows);
    } catch (err) {
      console.error("[conflict-notify] per-user resolution failed", {
        userId,
        planId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// Public — fired after auto-lock with a possible window shift. Each open
// ledger row involving `planId` is re-checked against the current state of
// both plans; pairs that no longer overlap (or where the user's vote drifted
// off IN on the other side) resolve. Pairs that still hold stay open.
export async function reevaluateConflictsForPlan(
  planId: string,
): Promise<void> {
  const rows = await db
    .select({
      id: conflictNotifications.id,
      userId: conflictNotifications.userId,
      planAId: conflictNotifications.planAId,
      planBId: conflictNotifications.planBId,
      sentAt: conflictNotifications.sentAt,
    })
    .from(conflictNotifications)
    .where(
      and(
        or(
          eq(conflictNotifications.planAId, planId),
          eq(conflictNotifications.planBId, planId),
        ),
        isNull(conflictNotifications.resolvedAt),
      ),
    );
  if (rows.length === 0) return;

  for (const row of rows) {
    const otherPlanId = row.planAId === planId ? row.planBId : row.planAId;
    try {
      const stillHard = await isStillHardConflict(
        row.userId,
        planId,
        otherPlanId,
      );
      if (stillHard) continue;
      await resolveSingleRow(row);
      await maybeDispatchResolved(row.userId, planId, otherPlanId, row.sentAt);
    } catch (err) {
      console.error("[conflict-notify] reevaluate row failed", {
        rowId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function isStillHardConflict(
  userId: string,
  planAId: string,
  planBId: string,
): Promise<boolean> {
  const [a, b] = await Promise.all([
    loadPlanWithCircle(planAId),
    loadPlanWithCircle(planBId),
  ]);
  if (!a || !b) return false;
  if (!planIsCommitmentEligible(a) || !planIsCommitmentEligible(b)) return false;

  const aEnd = new Date(a.startsAt.getTime() + a.durationMinutes * 60_000);
  const bEnd = new Date(b.startsAt.getTime() + b.durationMinutes * 60_000);
  if (!overlaps({ start: a.startsAt, end: aEnd }, { start: b.startsAt, end: bEnd })) {
    return false;
  }

  // User still IN on both? Either an `in` vote row or `created_by = userId`
  // counts (Flow C step 4 auto-in). One query joining votes for both ids is
  // overkill — two cheap reads stay readable.
  const [aOk, bOk] = await Promise.all([
    userHardCommitsTo(userId, a),
    userHardCommitsTo(userId, b),
  ]);
  return aOk && bOk;
}

async function userHardCommitsTo(
  userId: string,
  plan: LoadedPlan,
): Promise<boolean> {
  const planRow = await db.query.plans.findFirst({
    columns: { createdBy: true },
    where: eq(plans.id, plan.id),
  });
  if (planRow?.createdBy === userId) return true;
  const voteRow = await db.query.votes.findFirst({
    columns: { status: true },
    where: and(eq(votes.planId, plan.id), eq(votes.userId, userId)),
  });
  return voteRow?.status === "in";
}

async function resolveRowsAndPush(
  userId: string,
  anchorPlanId: string,
  rows: {
    id: string;
    planAId: string;
    planBId: string;
    sentAt: Date;
  }[],
): Promise<void> {
  for (const row of rows) {
    const otherPlanId =
      row.planAId === anchorPlanId ? row.planBId : row.planAId;
    await resolveSingleRow(row);
    await maybeDispatchResolved(userId, anchorPlanId, otherPlanId, row.sentAt);
  }
}

async function resolveSingleRow(row: { id: string }): Promise<void> {
  await db
    .update(conflictNotifications)
    .set({ resolvedAt: new Date() })
    .where(eq(conflictNotifications.id, row.id));
}

async function maybeDispatchResolved(
  userId: string,
  anchorPlanId: string,
  otherPlanId: string,
  sentAt: Date,
): Promise<void> {
  // §5 — resolution push only fires if the original conflict push went out
  // within the last 7 days. Older pairs resolve silently in the ledger; the
  // user already moved on.
  if (Date.now() - sentAt.getTime() > SEVEN_DAYS_MS) return;

  const [anchor, other] = await Promise.all([
    loadPlanWithCircle(anchorPlanId),
    loadPlanWithCircle(otherPlanId),
  ]);
  if (!anchor || !other) return;

  await dispatchResolvedPush(
    userId,
    {
      planId: anchor.id,
      planTitle: anchor.title,
      circleSlug: anchor.circleSlug,
      circleName: anchor.circleName,
    },
    {
      planId: other.id,
      planTitle: other.title,
      circleSlug: other.circleSlug,
      circleName: other.circleName,
    },
  );
}
