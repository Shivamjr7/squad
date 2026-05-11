"use server";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, plans, users, votes } from "@/db/schema";
import { requireMembership, requirePlanRecipient } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";
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
    columns: { circleId: true, status: true, title: true },
    where: eq(plans.id, data.planId),
  });
  if (!plan) {
    throw new ActionError("NOT_FOUND", "Plan not found.");
  }
  if (plan.status !== "active") {
    throw new ActionError("INVALID", "This plan is no longer accepting votes.");
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

  // Re-evaluate auto-lock after every cast. Cheap: short-circuits before any
  // extra queries when the plan isn't active. Three triggers can fire here —
  // M22 threshold, M22 deadline (only via cron), M29 all-voted.
  await tryAutoLock(data.planId);

  // M30 — notify other members when someone joins (votes "in") a plan. We
  // only fire on the IN edge: first cast of `in`, or switch from out/maybe
  // to in. Out/maybe/no-change casts don't notify, since the value to other
  // members is "+1 confirmed for the plan", not every vote churn.
  if (data.status === "in" && previousVote !== "in") {
    void notifyVoteIn(data.planId, plan.circleId, plan.title, userId).catch(
      (err) => {
        console.error("[votes.castVote] notify fanout failed", err);
      },
    );
  }

  return { status: data.status };
}

async function notifyVoteIn(
  planId: string,
  circleId: string,
  planTitle: string,
  voterId: string,
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

  await db
    .delete(votes)
    .where(and(eq(votes.planId, data.planId), eq(votes.userId, userId)));
}
