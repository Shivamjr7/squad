"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/db/client";
import { circles, plans, users, votes } from "@/db/schema";
import { requireMembership, requirePlanRecipient } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";
import { CIRCLE_TAGS } from "@/lib/circles";
import {
  castVoteSchema,
  removeVoteSchema,
  type CastVoteInput,
  type RemoveVoteInput,
  type VoteStatus,
} from "@/lib/validation/vote";
import { tryAutoLock } from "@/lib/actions/auto-lock";
import { recordPlanEvent } from "@/lib/actions/plan-events";
import {
  detectAndNotifyConflictsForUserPlan,
  resolveConflictsForUserOnPlan,
} from "@/lib/actions/conflict-notify";
import {
  dispatchNotifications,
  resolvePlanAudience,
} from "@/lib/notifications";

export async function castVote(
  input: CastVoteInput,
): Promise<{ status: VoteStatus }> {
  const parsed = castVoteSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid vote.",
    );
  }
  const data = parsed.data;

  const plan = await db.query.plans.findFirst({
    columns: {
      circleId: true,
      status: true,
      title: true,
      startsAt: true,
      timeZone: true,
      timeMode: true,
    },
    where: eq(plans.id, data.planId),
  });
  if (!plan) {
    throw new ActionError("NOT_FOUND", "Plan not found.");
  }
  // Vote-changes are accepted while the plan is active (the normal path)
  // AND after it locks ("confirmed"). The original design always intended
  // post-lock drop-outs — Receipt header note: "Even after lock, voters
  // can drop". done/cancelled remain frozen: their state is terminal and
  // letting votes mutate would desync notifications, conflict ledgers,
  // and the receipt audit trail.
  if (plan.status !== "active" && plan.status !== "confirmed") {
    throw new ActionError(
      "INVALID",
      plan.status === "cancelled"
        ? "This plan was cancelled."
        : "This plan is done.",
    );
  }

  const { userId } = await requireMembership(plan.circleId);
  await requirePlanRecipient(data.planId, userId);

  // M29 — capture the prior vote (if any) before the upsert so the event
  // payload can distinguish a first cast from a switch.
  const existing = await db
    .select({ status: votes.status })
    .from(votes)
    .where(and(eq(votes.planId, data.planId), eq(votes.userId, userId)))
    .limit(1);
  const previousVote = existing[0]?.status ?? null;

  await db
    .insert(votes)
    .values({
      planId: data.planId,
      userId,
      status: data.status,
    })
    .onConflictDoUpdate({
      target: [votes.planId, votes.userId],
      set: { status: data.status, votedAt: new Date() },
    });

  // M29 — post-upsert tally for the event payload. M30's notification
  // dispatcher reads these counts to render "4/6 in" copy without re-querying.
  const tallyRows = await db
    .select({
      status: votes.status,
      n: sql<number>`count(*)::int`,
    })
    .from(votes)
    .where(eq(votes.planId, data.planId))
    .groupBy(votes.status);

  const tallyByStatus = new Map<VoteStatus, number>();
  for (const r of tallyRows) {
    tallyByStatus.set(r.status as VoteStatus, Number(r.n));
  }
  const inCount = tallyByStatus.get("in") ?? 0;
  const outCount = tallyByStatus.get("out") ?? 0;
  const maybeCount = tallyByStatus.get("maybe") ?? 0;

  // M29: write-only event signal. M30 reads plan_events and owns all
  // delivery, batching, and spam policy decisions.
  void recordPlanEvent({
    planId: data.planId,
    userId,
    kind: "voted",
    payload: {
      vote: data.status,
      previousVote,
      inCount,
      outCount,
      maybeCount,
    },
  });

  // Squad-pulse derives from votes — flag the activity cache stale so the
  // home strip reflects this voter's pulse next render.
  revalidateTag(CIRCLE_TAGS.circleActivity);

  // Re-evaluate auto-lock after every cast. Cheap: short-circuits before any
  // extra queries when the plan isn't active. Three triggers can fire here —
  // M22 threshold, M22 deadline (only via cron), M29 all-voted.
  await tryAutoLock(data.planId);

  // M30 — notify other members when someone joins (votes "in") a plan. We
  // only fire on the IN edge: first cast of `in`, or switch from out/maybe
  // to in. Out/maybe/no-change casts don't notify, since the value to other
  // members is "+1 confirmed for the plan", not every vote churn.
  if (data.status === "in" && previousVote !== "in") {
    // M31 — open-mode plans haven't picked a time yet, so the push body
    // collapses to "Karan: in for {plan title}" rather than a half-formed
    // "in for —". The composer reads `startsAtIso === null` and drops the
    // time suffix.
    const startsAtIso =
      plan.timeMode === "exact" ? plan.startsAt.toISOString() : null;
    // Pair timeZone with startsAtIso: when starts is null (open-mode plan
    // before lock), zone is null too — the composer drops the time suffix.
    const planTimeZone = plan.timeMode === "exact" ? plan.timeZone : null;
    void notifyVoteIn(
      data.planId,
      plan.circleId,
      plan.title,
      userId,
      startsAtIso,
      planTimeZone,
    ).catch((err) => {
      console.error("[votes.castVote] notify fanout failed", err);
    });

    // M32.7 — same edge fires conflict detection. The user just locked in
    // their commitment to this plan; if it overlaps another commitment they
    // already have, they get a single `plan_conflict` push (ledger-deduped).
    void detectAndNotifyConflictsForUserPlan(userId, data.planId).catch(
      (err) => {
        console.error("[votes.castVote] conflict detect failed", err);
      },
    );
  } else if (previousVote === "in" && data.status !== "in") {
    // M32.7 — IN → MAYBE/OUT. The user is no longer hard-committed to this
    // plan, so any open ledger rows pairing this plan with another of their
    // commitments resolve (with a resolution push if the original was within
    // 7 days, per §5).
    void resolveConflictsForUserOnPlan(userId, data.planId).catch((err) => {
      console.error("[votes.castVote] conflict resolve failed", err);
    });
  }

  return { status: data.status };
}

async function notifyVoteIn(
  planId: string,
  circleId: string,
  planTitle: string,
  voterId: string,
  startsAtIso: string | null,
  timeZone: string | null,
): Promise<void> {
  const [circle, voter] = await Promise.all([
    db.query.circles.findFirst({
      columns: { slug: true, name: true },
      where: eq(circles.id, circleId),
    }),
    db.query.users.findFirst({
      columns: { displayName: true },
      where: eq(users.id, voterId),
    }),
  ]);
  if (!circle) return;

  const audience = await resolvePlanAudience(planId, circleId, voterId);
  if (audience.length === 0) return;

  await dispatchNotifications({
    type: "vote_in",
    userIds: audience,
    payload: {
      planId,
      planTitle,
      circleSlug: circle.slug,
      circleName: circle.name,
      voterName: voter?.displayName ?? "Someone",
      voterId,
      startsAtIso,
      timeZone,
    },
  });
}

export async function removeVote(input: RemoveVoteInput): Promise<void> {
  const parsed = removeVoteSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid vote.",
    );
  }
  const data = parsed.data;

  const plan = await db.query.plans.findFirst({
    columns: { circleId: true },
    where: eq(plans.id, data.planId),
  });
  if (!plan) {
    throw new ActionError("NOT_FOUND", "Plan not found.");
  }

  const { userId } = await requireMembership(plan.circleId);

  // Capture the prior vote so we know whether to resolve conflicts (only
  // matters when the removed vote was IN — anything else can't have
  // produced a hard conflict).
  const existing = await db
    .select({ status: votes.status })
    .from(votes)
    .where(and(eq(votes.planId, data.planId), eq(votes.userId, userId)))
    .limit(1);
  const previousVote = existing[0]?.status ?? null;

  await db
    .delete(votes)
    .where(and(eq(votes.planId, data.planId), eq(votes.userId, userId)));

  if (previousVote === "in") {
    void resolveConflictsForUserOnPlan(userId, data.planId).catch((err) => {
      console.error("[votes.removeVote] conflict resolve failed", err);
    });
  }
}
