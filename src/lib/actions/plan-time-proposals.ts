"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import {
  circles,
  planTimeProposalVotes,
  planTimeProposals,
  plans,
} from "@/db/schema";
import { requireMembership, requirePlanRecipient } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";
import {
  castProposalVoteSchema,
  proposeTimeSchema,
  type CastProposalVoteInput,
  type ProposeTimeInput,
} from "@/lib/validation/plan-time-proposal";
import { isValidTimeZone, zonedWallClockToUtc } from "@/lib/tz";
import { tryAutoLock } from "@/lib/actions/auto-lock";

// Counter-propose a different time on an exact-time plan. Anyone in the
// circle can suggest. If the plan has no proposals yet, we seed the original
// starts_at (with proposed_by = plans.created_by) so it's an equal candidate
// in the vote — otherwise the original time would be invisible the moment a
// counter-proposal lands.
export async function proposeTime(
  input: ProposeTimeInput,
): Promise<{ proposalId: string }> {
  const parsed = proposeTimeSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid time proposal.",
    );
  }
  const data = parsed.data;

  if (!isValidTimeZone(data.timeZone)) {
    throw new ActionError("INVALID", "Unrecognized time zone.");
  }

  let startsAt: Date;
  try {
    startsAt = zonedWallClockToUtc(data.startsAtLocal, data.timeZone);
  } catch {
    throw new ActionError("INVALID", "Pick a valid date and time.");
  }

  const plan = await db.query.plans.findFirst({
    columns: {
      id: true,
      circleId: true,
      status: true,
      timeMode: true,
      startsAt: true,
      createdBy: true,
    },
    where: eq(plans.id, data.planId),
  });
  if (!plan) {
    throw new ActionError("NOT_FOUND", "Plan not found.");
  }
  if (plan.status !== "active") {
    throw new ActionError(
      "INVALID",
      "This plan is no longer accepting proposals.",
    );
  }
  if (plan.timeMode !== "exact") {
    throw new ActionError(
      "INVALID",
      "This plan uses time-slot voting. Use the heatmap.",
    );
  }

  const { userId } = await requireMembership(plan.circleId);
  await requirePlanRecipient(data.planId, userId);

  if (startsAt.getTime() <= Date.now()) {
    throw new ActionError("INVALID", "Pick a time in the future.");
  }

  const proposalId = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: planTimeProposals.id })
      .from(planTimeProposals)
      .where(eq(planTimeProposals.planId, data.planId))
      .limit(1);

    // Promote single-time plan to multi-proposal by seeding the original.
    // We attribute the seed row to plan.createdBy (or NULL if the creator
    // deleted their account) so the original time has its own author label.
    if (existing.length === 0) {
      await tx.insert(planTimeProposals).values({
        planId: data.planId,
        startsAt: plan.startsAt,
        proposedBy: plan.createdBy,
      });
    }

    const [row] = await tx
      .insert(planTimeProposals)
      .values({
        planId: data.planId,
        startsAt,
        proposedBy: userId,
      })
      .returning({ id: planTimeProposals.id });
    if (!row) {
      throw new ActionError("INVALID", "Could not save proposal.");
    }
    return row.id;
  });

  const circle = await db.query.circles.findFirst({
    columns: { slug: true },
    where: eq(circles.id, plan.circleId),
  });
  if (circle?.slug) {
    revalidatePath(`/c/${circle.slug}/p/${data.planId}`);
  }

  return { proposalId };
}

// Toggle a vote on a time proposal. One vote per (plan, user): switching to
// a different proposal deducts the prior. Tapping the same proposal retracts.
export async function castProposalVote(
  input: CastProposalVoteInput,
): Promise<{ proposalId: string; voted: boolean; locked: boolean }> {
  const parsed = castProposalVoteSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid proposal vote.",
    );
  }
  const { planId, proposalId } = parsed.data;

  const proposal = await db.query.planTimeProposals.findFirst({
    columns: { id: true, planId: true },
    where: eq(planTimeProposals.id, proposalId),
  });
  if (!proposal || proposal.planId !== planId) {
    throw new ActionError("NOT_FOUND", "Proposal not found for that plan.");
  }

  const plan = await db.query.plans.findFirst({
    columns: { id: true, circleId: true, status: true },
    where: eq(plans.id, planId),
  });
  if (!plan) {
    throw new ActionError("NOT_FOUND", "Plan not found.");
  }
  if (plan.status !== "active") {
    throw new ActionError(
      "INVALID",
      "This plan is no longer accepting time votes.",
    );
  }

  const { userId } = await requireMembership(plan.circleId);
  await requirePlanRecipient(planId, userId);

  // Find any prior vote by this user on any proposal of this plan.
  const existing = await db
    .select({
      id: planTimeProposalVotes.id,
      proposalId: planTimeProposalVotes.proposalId,
    })
    .from(planTimeProposalVotes)
    .innerJoin(
      planTimeProposals,
      eq(planTimeProposals.id, planTimeProposalVotes.proposalId),
    )
    .where(
      and(
        eq(planTimeProposals.planId, planId),
        eq(planTimeProposalVotes.userId, userId),
      ),
    )
    .limit(1);

  let voted: boolean;
  if (existing.length > 0 && existing[0].proposalId === proposalId) {
    await db
      .delete(planTimeProposalVotes)
      .where(eq(planTimeProposalVotes.id, existing[0].id));
    voted = false;
  } else {
    if (existing.length > 0) {
      await db
        .delete(planTimeProposalVotes)
        .where(eq(planTimeProposalVotes.id, existing[0].id));
    }
    await db.insert(planTimeProposalVotes).values({ proposalId, userId });
    voted = true;
  }

  // After every vote we re-evaluate auto-lock; cheap because tryAutoLock
  // short-circuits when the in-vote threshold isn't met.
  const lockResult = await tryAutoLock(planId);

  const circle = await db.query.circles.findFirst({
    columns: { slug: true },
    where: eq(circles.id, plan.circleId),
  });
  if (circle?.slug) {
    revalidatePath(`/c/${circle.slug}/p/${planId}`);
    if (lockResult.lockedNow) revalidatePath(`/c/${circle.slug}`);
  }

  return { proposalId, voted, locked: lockResult.lockedNow };
}
