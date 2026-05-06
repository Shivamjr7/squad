"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import {
  circles,
  planVenueVotes,
  planVenues,
  plans,
} from "@/db/schema";
import { requireMembership, requirePlanRecipient } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";
import {
  addVenueSchema,
  castVenueVoteSchema,
  type AddVenueInput,
  type CastVenueVoteInput,
} from "@/lib/validation/plan-venue";
import { tryAutoLock } from "@/lib/actions/auto-lock";

// Cast or switch a venue vote. One vote per (plan, user): if the caller has
// already voted on a different venue in this plan, that earlier vote is
// deleted before the new one is recorded. Tapping the venue you already
// voted for retracts your vote.
export async function castVenueVote(
  input: CastVenueVoteInput,
): Promise<{ venueId: string; voted: boolean }> {
  const parsed = castVenueVoteSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid venue vote.",
    );
  }
  const { planId, venueId } = parsed.data;

  const venue = await db.query.planVenues.findFirst({
    columns: { id: true, planId: true },
    where: eq(planVenues.id, venueId),
  });
  if (!venue || venue.planId !== planId) {
    throw new ActionError("NOT_FOUND", "Venue not found for that plan.");
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
      "This plan is no longer accepting venue votes.",
    );
  }

  const { userId } = await requireMembership(plan.circleId);
  await requirePlanRecipient(planId, userId);

  // Find any existing vote by this user on any venue belonging to this plan.
  const existing = await db
    .select({ id: planVenueVotes.id, venueId: planVenueVotes.venueId })
    .from(planVenueVotes)
    .innerJoin(planVenues, eq(planVenues.id, planVenueVotes.venueId))
    .where(
      and(
        eq(planVenues.planId, planId),
        eq(planVenueVotes.userId, userId),
      ),
    )
    .limit(1);

  let voted: boolean;
  if (existing.length > 0 && existing[0].venueId === venueId) {
    // Tapping the same venue retracts.
    await db
      .delete(planVenueVotes)
      .where(eq(planVenueVotes.id, existing[0].id));
    voted = false;
  } else {
    if (existing.length > 0) {
      await db
        .delete(planVenueVotes)
        .where(eq(planVenueVotes.id, existing[0].id));
    }
    await db.insert(planVenueVotes).values({ venueId, userId });
    voted = true;
  }

  // M22 — venue plurality changes can tip a lock; re-evaluate after each cast.
  await tryAutoLock(planId);

  const circle = await db.query.circles.findFirst({
    columns: { slug: true },
    where: eq(circles.id, plan.circleId),
  });
  if (circle?.slug) {
    revalidatePath(`/c/${circle.slug}/p/${planId}`);
    revalidatePath(`/c/${circle.slug}`);
  }

  return { venueId, voted };
}

// Mid-flight venue suggestion. Anyone in the circle (recipients tightening
// lands in M23) can add a counter-proposal. Implicit single-venue plans
// (only plans.location, no plan_venues rows) are promoted to a multi-venue
// plan by seeding the original location as the first row.
export async function addVenue(
  input: AddVenueInput,
): Promise<{ venueId: string }> {
  const parsed = addVenueSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid venue.",
    );
  }
  const { planId, label } = parsed.data;

  const plan = await db.query.plans.findFirst({
    columns: { id: true, circleId: true, status: true, location: true },
    where: eq(plans.id, planId),
  });
  if (!plan) {
    throw new ActionError("NOT_FOUND", "Plan not found.");
  }
  if (plan.status !== "active") {
    throw new ActionError(
      "INVALID",
      "This plan is no longer accepting venue suggestions.",
    );
  }

  const { userId } = await requireMembership(plan.circleId);
  await requirePlanRecipient(planId, userId);

  const venueId = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: planVenues.id })
      .from(planVenues)
      .where(eq(planVenues.planId, planId))
      .limit(1);

    // Promote single-venue plans to multi-venue by seeding the canonical
    // location as the first option, so the prior choice stays in the vote.
    if (existing.length === 0 && plan.location) {
      await tx.insert(planVenues).values({
        planId,
        label: plan.location,
        suggestedBy: null,
      });
    }

    const [row] = await tx
      .insert(planVenues)
      .values({
        planId,
        label,
        suggestedBy: userId,
      })
      .returning({ id: planVenues.id });
    if (!row) {
      throw new ActionError("INVALID", "Could not add venue.");
    }
    return row.id;
  });

  const circle = await db.query.circles.findFirst({
    columns: { slug: true },
    where: eq(circles.id, plan.circleId),
  });
  if (circle?.slug) {
    revalidatePath(`/c/${circle.slug}/p/${planId}`);
    revalidatePath(`/c/${circle.slug}`);
  }

  return { venueId };
}

// On lock (open-time auto-lock or manual confirm), if the plan has multi-
// venue voting, capture the winning venue's label as the canonical
// plans.location so existing maps + email code keeps working without
// branching. Tie-breaker: earliest-proposed wins (matches M22 rule).
// Returns the new label or null if no venues exist for this plan.
export async function captureWinningVenue(
  planId: string,
): Promise<string | null> {
  const venues = await db
    .select({
      id: planVenues.id,
      label: planVenues.label,
      createdAt: planVenues.createdAt,
    })
    .from(planVenues)
    .where(eq(planVenues.planId, planId))
    .orderBy(asc(planVenues.createdAt));
  if (venues.length === 0) return null;

  const counts = await db
    .select({
      venueId: planVenueVotes.venueId,
      n: sql<number>`count(*)::int`,
    })
    .from(planVenueVotes)
    .innerJoin(planVenues, eq(planVenues.id, planVenueVotes.venueId))
    .where(eq(planVenues.planId, planId))
    .groupBy(planVenueVotes.venueId);

  const countMap = new Map<string, number>();
  for (const c of counts) countMap.set(c.venueId, Number(c.n));

  // Walk venues in createdAt order so earliest wins on ties.
  let winner = venues[0];
  let winnerVotes = countMap.get(winner.id) ?? 0;
  for (let i = 1; i < venues.length; i++) {
    const v = venues[i];
    const c = countMap.get(v.id) ?? 0;
    if (c > winnerVotes) {
      winner = v;
      winnerVotes = c;
    }
  }

  await db
    .update(plans)
    .set({ location: winner.label })
    .where(eq(plans.id, planId));

  return winner.label;
}
