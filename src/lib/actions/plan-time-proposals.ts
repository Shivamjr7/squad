"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import {
  circles,
  planEvents,
  planTimeProposalVotes,
  planTimeProposals,
  plans,
  votes,
} from "@/db/schema";
import { requireMembership, requirePlanRecipient } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";
import { emitBroadcast, RT, RT_EVENT } from "@/lib/realtime/server";
import { takeToken, RATE } from "@/lib/rate-limit";
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
): Promise<{
  proposalId: string;
  startsAt: string;
  proposedBy: string | null;
  createdAt: string;
  kind: "replacement" | "addition";
  label: string | null;
}> {
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
  const isAddition = data.kind === "addition";
  if (
    (isAddition && plan.status !== "active" && plan.status !== "confirmed") ||
    (!isAddition && plan.status !== "active")
  ) {
    throw new ActionError(
      "INVALID",
      isAddition
        ? "This plan is no longer accepting add-ons."
        : "This plan is no longer accepting proposals.",
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
  await takeToken({
    action: "proposeTime",
    key: userId,
    ...RATE.proposeTime,
  });

  if (startsAt.getTime() <= Date.now()) {
    throw new ActionError("INVALID", "Pick a time in the future.");
  }

  // M24 — additions don't compete with the canonical time, so we never seed
  // the original starts_at row when adding one. Replacements keep the M22
  // behavior of seeding the original so the prior time stays in the vote.
  const label = isAddition ? data.label?.trim() || null : null;

  type ProposalRowOut = {
    id: string;
    startsAt: Date;
    proposedBy: string | null;
    createdAt: Date;
  };
  const { newRow, seedRow } = await db.transaction(async (tx) => {
    let seed: ProposalRowOut | null = null;
    if (!isAddition) {
      const existing = await tx
        .select({ id: planTimeProposals.id })
        .from(planTimeProposals)
        .where(
          and(
            eq(planTimeProposals.planId, data.planId),
            eq(planTimeProposals.kind, "replacement"),
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        const [seedInsert] = await tx
          .insert(planTimeProposals)
          .values({
            planId: data.planId,
            startsAt: plan.startsAt,
            proposedBy: plan.createdBy,
            kind: "replacement",
          })
          .returning({
            id: planTimeProposals.id,
            startsAt: planTimeProposals.startsAt,
            proposedBy: planTimeProposals.proposedBy,
            createdAt: planTimeProposals.createdAt,
          });
        if (seedInsert) seed = seedInsert;
      }
    }

    const [row] = await tx
      .insert(planTimeProposals)
      .values({
        planId: data.planId,
        startsAt,
        proposedBy: userId,
        kind: data.kind,
        label,
      })
      .returning({
        id: planTimeProposals.id,
        startsAt: planTimeProposals.startsAt,
        proposedBy: planTimeProposals.proposedBy,
        createdAt: planTimeProposals.createdAt,
      });
    if (!row) {
      throw new ActionError("INVALID", "Could not save proposal.");
    }

    // M24 — log to activity timeline. Inside the transaction so a rolled-back
    // proposal doesn't leave an event behind.
    await tx.insert(planEvents).values({
      planId: data.planId,
      userId,
      kind: "proposed_time",
      payload: {
        kind: data.kind,
        startsAt: startsAt.toISOString(),
        label: label ?? undefined,
      },
    });

    return { newRow: row, seedRow: seed };
  });
  const proposalId = newRow.id;

  // Broadcast the seeded original first so it appears as the prior
  // option for any client mid-render.
  if (seedRow) {
    void emitBroadcast(RT.proposals(data.planId), RT_EVENT.proposalChanged, {
      op: "upsert",
      planId: data.planId,
      id: seedRow.id,
      startsAt: seedRow.startsAt.toISOString(),
      proposedBy: seedRow.proposedBy,
      createdAt: seedRow.createdAt.toISOString(),
      kind: "replacement",
      label: null,
    });
  }
  void emitBroadcast(RT.proposals(data.planId), RT_EVENT.proposalChanged, {
    op: "upsert",
    planId: data.planId,
    id: newRow.id,
    startsAt: newRow.startsAt.toISOString(),
    proposedBy: newRow.proposedBy,
    createdAt: newRow.createdAt.toISOString(),
    kind: data.kind,
    label,
  });

  const circle = await db.query.circles.findFirst({
    columns: { slug: true },
    where: eq(circles.id, plan.circleId),
  });
  if (circle?.slug) {
    revalidatePath(`/c/${circle.slug}/p/${data.planId}`);
  }

  return {
    proposalId,
    startsAt: newRow.startsAt.toISOString(),
    proposedBy: newRow.proposedBy,
    createdAt: newRow.createdAt.toISOString(),
    kind: data.kind,
    label,
  };
}

// Toggle a vote on a replacement time proposal. One vote per (plan, user):
// switching to a different replacement deducts the prior. Tapping the same
// proposal retracts.
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
    columns: { id: true, planId: true, kind: true },
    where: eq(planTimeProposals.id, proposalId),
  });
  if (!proposal || proposal.planId !== planId) {
    throw new ActionError("NOT_FOUND", "Proposal not found for that plan.");
  }
  if (proposal.kind !== "replacement") {
    throw new ActionError("INVALID", "Add-ons are not time vote options.");
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
        eq(planTimeProposals.kind, "replacement"),
        eq(planTimeProposalVotes.userId, userId),
      ),
    )
    .limit(1);

  let voted: boolean;
  let previousProposalId: string | null = null;
  if (existing.length > 0 && existing[0].proposalId === proposalId) {
    await db
      .delete(planTimeProposalVotes)
      .where(eq(planTimeProposalVotes.id, existing[0].id));
    voted = false;
  } else {
    if (existing.length > 0) {
      previousProposalId = existing[0].proposalId;
      await db
        .delete(planTimeProposalVotes)
        .where(eq(planTimeProposalVotes.id, existing[0].id));
    }
    await db.insert(planTimeProposalVotes).values({ proposalId, userId });
    voted = true;
  }

  // Picking a concrete replacement time implies "I'm in for this option".
  // Keep the plan-level RSVP in sync so threshold locking, squad counts,
  // and the hero CTA don't wait for a second explicit tap on "I'm in".
  let promotedPlanVoteAt: Date | null = null;
  if (voted) {
    const existingPlanVote = await db
      .select({
        id: votes.id,
        status: votes.status,
      })
      .from(votes)
      .where(and(eq(votes.planId, planId), eq(votes.userId, userId)))
      .limit(1);

    if (existingPlanVote[0]?.status !== "in") {
      promotedPlanVoteAt = new Date();
      await db
        .insert(votes)
        .values({
          planId,
          userId,
          status: "in",
          votedAt: promotedPlanVoteAt,
        })
        .onConflictDoUpdate({
          target: [votes.planId, votes.userId],
          set: { status: "in", votedAt: promotedPlanVoteAt },
        });
    }
  }

  if (previousProposalId) {
    void emitBroadcast(
      RT.proposals(planId),
      RT_EVENT.proposalVoteChanged,
      { op: "delete", planId, proposalId: previousProposalId, userId },
    );
  }
  void emitBroadcast(
    RT.proposals(planId),
    RT_EVENT.proposalVoteChanged,
    {
      op: voted ? "upsert" : "delete",
      planId,
      proposalId,
      userId,
    },
  );
  if (promotedPlanVoteAt) {
    void emitBroadcast(RT.votes(planId), RT_EVENT.voteChanged, {
      op: "upsert",
      planId,
      userId,
      status: "in",
      votedAt: promotedPlanVoteAt.toISOString(),
    });
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
    if (promotedPlanVoteAt) revalidatePath(`/c/${circle.slug}/plans`);
  }
  if (promotedPlanVoteAt) revalidatePath("/");

  return { proposalId, voted, locked: lockResult.lockedNow };
}

// Toggle a user's attendance for a stacked add-on. Unlike replacement-time
// votes, add-on votes are independent: a user can join multiple add-ons, and
// this never affects canonical plan time selection or auto-lock.
export async function toggleAdditionVote(
  input: CastProposalVoteInput,
): Promise<{ proposalId: string; voted: boolean }> {
  const parsed = castProposalVoteSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid add-on vote.",
    );
  }
  const { planId, proposalId } = parsed.data;

  const proposal = await db.query.planTimeProposals.findFirst({
    columns: { id: true, planId: true, kind: true },
    where: eq(planTimeProposals.id, proposalId),
  });
  if (!proposal || proposal.planId !== planId) {
    throw new ActionError("NOT_FOUND", "Add-on not found for that plan.");
  }
  if (proposal.kind !== "addition") {
    throw new ActionError("INVALID", "That is not an add-on.");
  }

  const plan = await db.query.plans.findFirst({
    columns: { id: true, circleId: true, status: true },
    where: eq(plans.id, planId),
  });
  if (!plan) {
    throw new ActionError("NOT_FOUND", "Plan not found.");
  }
  if (plan.status !== "active" && plan.status !== "confirmed") {
    throw new ActionError(
      "INVALID",
      "This plan is no longer accepting add-on votes.",
    );
  }

  const { userId } = await requireMembership(plan.circleId);
  await requirePlanRecipient(planId, userId);

  const existing = await db
    .select({ id: planTimeProposalVotes.id })
    .from(planTimeProposalVotes)
    .where(
      and(
        eq(planTimeProposalVotes.proposalId, proposalId),
        eq(planTimeProposalVotes.userId, userId),
      ),
    )
    .limit(1);

  const voted = existing.length === 0;
  if (voted) {
    await db.insert(planTimeProposalVotes).values({ proposalId, userId });
  } else {
    await db
      .delete(planTimeProposalVotes)
      .where(eq(planTimeProposalVotes.id, existing[0].id));
  }

  void emitBroadcast(
    RT.proposals(planId),
    RT_EVENT.proposalVoteChanged,
    {
      op: voted ? "upsert" : "delete",
      planId,
      proposalId,
      userId,
      kind: "addition",
    },
  );

  const circle = await db.query.circles.findFirst({
    columns: { slug: true },
    where: eq(circles.id, plan.circleId),
  });
  if (circle?.slug) {
    revalidatePath(`/c/${circle.slug}/p/${planId}`);
  }

  return { proposalId, voted };
}
