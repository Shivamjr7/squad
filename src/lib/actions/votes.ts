"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { plans, votes } from "@/db/schema";
import { requireMembership } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";
import {
  castVoteSchema,
  removeVoteSchema,
  type CastVoteInput,
  type RemoveVoteInput,
  type VoteStatus,
} from "@/lib/validation/vote";
import { tryAutoLock } from "@/lib/actions/auto-lock";

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
    columns: { circleId: true, status: true },
    where: eq(plans.id, data.planId),
  });
  if (!plan) {
    throw new ActionError("NOT_FOUND", "Plan not found.");
  }
  if (plan.status !== "active") {
    throw new ActionError("INVALID", "This plan is no longer accepting votes.");
  }

  const { userId } = await requireMembership(plan.circleId);

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

  // M22 — re-evaluate auto-lock after every cast. Cheap: short-circuits
  // before any extra queries when the plan isn't active or the threshold
  // isn't met. Only "in" votes count toward the threshold but we re-check
  // unconditionally so a switch from out→in fires the lock.
  await tryAutoLock(data.planId);

  return { status: data.status };
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
