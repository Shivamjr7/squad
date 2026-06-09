"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import {
  circles,
  plans,
  timeSlotVotes,
  timeSlots,
} from "@/db/schema";
import { requireMembership, requirePlanRecipient } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";
import { emitBroadcast, RT, RT_EVENT } from "@/lib/realtime/server";
import {
  toggleSlotVoteSchema,
  type ToggleSlotVoteInput,
} from "@/lib/validation/time-slot";
import { captureWinningVenue } from "@/lib/actions/plan-venues";
import { recordPlanEvent } from "@/lib/actions/plan-events";
import {
  detectAndNotifyConflictsForAudience,
  reevaluateConflictsForPlan,
} from "@/lib/actions/conflict-notify";
import { getEligibleVoters } from "@/lib/actions/eligibility";
import {
  dispatchPlanLockedNotification,
} from "@/lib/actions/plan-lock-notifications";
import { resolvePlanAudience } from "@/lib/notifications";

export type SlotVoteResult = {
  slotId: string;
  // True if the user is now voted on this slot, false if they retracted.
  voted: boolean;
  // Set when this vote tipped the plan over the threshold and locked it.
  locked: boolean;
};

export async function toggleSlotVote(
  input: ToggleSlotVoteInput,
): Promise<SlotVoteResult> {
  const parsed = toggleSlotVoteSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid slot vote.",
    );
  }
  const { planId, slotId } = parsed.data;

  // Look up the slot + plan together so we can validate ownership in one shot
  // and avoid a second round-trip for the plan row.
  const slot = await db.query.timeSlots.findFirst({
    columns: { id: true, planId: true, startsAt: true },
    where: eq(timeSlots.id, slotId),
  });
  if (!slot || slot.planId !== planId) {
    throw new ActionError("NOT_FOUND", "Time slot not found for that plan.");
  }

  const plan = await db.query.plans.findFirst({
    columns: {
      id: true,
      circleId: true,
      status: true,
      timeMode: true,
      lockThreshold: true,
    },
    where: eq(plans.id, planId),
  });
  if (!plan) {
    throw new ActionError("NOT_FOUND", "Plan not found.");
  }
  if (plan.timeMode !== "open") {
    throw new ActionError(
      "INVALID",
      "This plan's time is already locked.",
    );
  }
  if (plan.status !== "active") {
    throw new ActionError(
      "INVALID",
      "This plan is no longer accepting time votes.",
    );
  }

  const { userId } = await requireMembership(plan.circleId);
  await requirePlanRecipient(planId, userId);

  // Toggle: if the row exists, delete it; otherwise insert. The unique
  // (slot_id, user_id) constraint guarantees at most one row per pair.
  const existing = await db.query.timeSlotVotes.findFirst({
    columns: { id: true },
    where: and(
      eq(timeSlotVotes.slotId, slotId),
      eq(timeSlotVotes.userId, userId),
    ),
  });

  let voted: boolean;
  if (existing) {
    await db.delete(timeSlotVotes).where(eq(timeSlotVotes.id, existing.id));
    voted = false;
  } else {
    await db.insert(timeSlotVotes).values({ slotId, userId });
    voted = true;
  }

  void emitBroadcast(RT.slotVotes(planId), RT_EVENT.slotVoteChanged, {
    op: voted ? "upsert" : "delete",
    planId,
    slotId,
    userId,
  });

  let locked = false;
  if (voted) {
    // Check threshold for THIS slot. We only lock on insert paths — retracts
    // can't flip threshold from below to above.
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(timeSlotVotes)
      .where(eq(timeSlotVotes.slotId, slotId));
    const count = Number(row?.n ?? 0);
    const eligibleCount = (await getEligibleVoters(planId)).length;
    const lockThreshold = Math.max(
      1,
      Math.min(plan.lockThreshold, eligibleCount || plan.lockThreshold),
    );
    if (count >= lockThreshold) {
      locked = await lockOpenPlan(planId, slot.id, slot.startsAt, {
        trigger: "threshold",
      });
    }
  }

  // Refresh the plan-detail page so server-rendered state catches up.
  const circle = await db.query.circles.findFirst({
    columns: { slug: true },
    where: eq(circles.id, plan.circleId),
  });
  if (circle?.slug) {
    revalidatePath(`/c/${circle.slug}/p/${planId}`);
    if (locked) {
      revalidatePath("/");
      revalidatePath(`/c/${circle.slug}`);
      revalidatePath(`/c/${circle.slug}/plans`);
    }
  }

  return { slotId, voted, locked };
}

// Atomically transition an open-time plan to confirmed at the winning slot's
// time. Guarded by `time_mode = 'open'` so two concurrent vote-driven locks
// can't both succeed. Returns whether THIS call actually performed the lock.
export async function lockOpenPlan(
  planId: string,
  _slotId: string,
  startsAt: Date,
  opts: { trigger?: "threshold" | "forced" | "all_voted" } = {},
): Promise<boolean> {
  const plan = await db.query.plans.findFirst({
    columns: {
      id: true,
      circleId: true,
      title: true,
      timeZone: true,
      status: true,
    },
    where: eq(plans.id, planId),
  });
  if (!plan) return false;

  const updated = await db
    .update(plans)
    .set({
      startsAt,
      timeMode: "exact",
      status: "confirmed",
    })
    .where(and(eq(plans.id, planId), eq(plans.timeMode, "open")))
    .returning({ id: plans.id });

  if (updated.length === 0) return false;

  // M21 — capture leading venue label as the canonical location so the
  // confirmation email + map deep-links read a single source of truth.
  const winningVenue = await captureWinningVenue(planId);

  void recordPlanEvent({
    planId,
    userId: null,
    kind: "locked",
    payload: {
      startsAt: startsAt.toISOString(),
      location: winningVenue,
      mode: "open",
    },
  });

  const circle = await db.query.circles.findFirst({
    columns: { slug: true, name: true },
    where: eq(circles.id, plan.circleId),
  });

  if (circle) {
    void dispatchPlanLockedNotification({
      planId,
      circleId: plan.circleId,
      circleSlug: circle.slug,
      circleName: circle.name,
      startsAt,
      timeZone: plan.timeZone,
      location: winningVenue,
      trigger: opts.trigger ?? "threshold",
    });
  }

  void (async () => {
    try {
      await reevaluateConflictsForPlan(planId);
      const audience = await resolvePlanAudience(planId, plan.circleId, null);
      await detectAndNotifyConflictsForAudience(planId, audience);
    } catch (err) {
      console.error("[time-slots.lockOpenPlan] conflict reconcile failed", {
        planId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return true;
}
