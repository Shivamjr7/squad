"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, plans, timeSlots, votes } from "@/db/schema";
import { canModifyPlan, requireMembership } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";
import {
  createPlanSchema,
  planIdSchema,
  type CreatePlanInput,
  type PlanIdInput,
} from "@/lib/validation/plan";
import { isValidTimeZone, zonedWallClockToUtc } from "@/lib/tz";
import { getAppUrl } from "@/lib/url";
import {
  sendNewPlanEmail,
  sendPlanCancelledEmail,
  sendPlanConfirmedEmail,
} from "@/lib/email";

export async function createPlan(
  input: CreatePlanInput,
): Promise<{ planId: string; slug: string }> {
  const { userId } = await requireMembership(input.circleId);

  const parsed = createPlanSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid plan details.",
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

  let decideBy: Date | null = null;
  if (data.decideByLocal) {
    try {
      decideBy = zonedWallClockToUtc(data.decideByLocal, data.timeZone);
    } catch {
      throw new ActionError("INVALID", "Pick a valid deadline.");
    }
    if (decideBy.getTime() >= startsAt.getTime()) {
      throw new ActionError(
        "INVALID",
        "Decide-by must be before the plan's start time.",
      );
    }
  }

  const circle = await db.query.circles.findFirst({
    columns: { slug: true },
    where: eq(circles.id, data.circleId),
  });
  if (!circle) {
    throw new ActionError("NOT_FOUND", "Circle not found.");
  }

  const planId = await db.transaction(async (tx) => {
    const [plan] = await tx
      .insert(plans)
      .values({
        circleId: data.circleId,
        title: data.title,
        type: data.type,
        timeMode: data.timeMode,
        startsAt,
        isApproximate: data.isApproximate,
        location: data.location,
        maxPeople: data.maxPeople,
        decideBy,
        createdBy: userId,
        status: "active",
      })
      .returning({ id: plans.id });

    if (!plan) {
      throw new ActionError("INVALID", "Failed to create plan.");
    }

    // Creator's vote auto-set to 'in' per PLAN.md §6 Flow C step 4.
    await tx.insert(votes).values({
      planId: plan.id,
      userId,
      status: "in",
    });

    // Open-time mode: seed 5 hourly slots anchored on the picked startsAt.
    // Slots run from (startsAt - 2h) through (startsAt + 2h), one per hour.
    // Anchored on a top-of-hour boundary so cells line up cleanly with
    // wall-clock labels in the heatmap.
    if (data.timeMode === "open") {
      const anchorMs = startsAt.getTime();
      const topOfHourMs = anchorMs - (anchorMs % (60 * 60_000));
      const seedRows = [];
      for (let i = -2; i <= 2; i++) {
        seedRows.push({
          planId: plan.id,
          startsAt: new Date(topOfHourMs + i * 60 * 60_000),
          durationMinutes: 60,
        });
      }
      await tx.insert(timeSlots).values(seedRows);
    }

    return plan.id;
  });

  // Fire-and-forget: a Resend outage must not block plan creation.
  const appUrl = await getAppUrl();
  void sendNewPlanEmail(planId, appUrl).catch((err) => {
    console.error("[plans.createPlan] email fanout failed", err);
  });

  return { planId, slug: circle.slug };
}

// Shared auth + lookup for the three status mutations. Caller-or-admin
// authorization per PLAN.md §6 Flow F. Returns the plan row so the action
// can read current state for state-machine guards and (later) wire emails.
async function loadPlanForStatusChange(input: PlanIdInput) {
  const parsed = planIdSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError("INVALID", "Invalid plan id.");
  }
  const plan = await db.query.plans.findFirst({
    columns: {
      id: true,
      circleId: true,
      createdBy: true,
      status: true,
    },
    where: eq(plans.id, parsed.data.planId),
  });
  if (!plan) {
    throw new ActionError("NOT_FOUND", "Plan not found.");
  }
  const { userId, role } = await requireMembership(plan.circleId);
  if (!canModifyPlan(plan, userId, { role })) {
    throw new ActionError(
      "FORBIDDEN",
      "Only the plan's creator or a circle admin can change its status.",
    );
  }
  return { plan, userId };
}

export async function markPlanDone(input: PlanIdInput): Promise<void> {
  const { plan } = await loadPlanForStatusChange(input);
  if (plan.status !== "active" && plan.status !== "confirmed") {
    throw new ActionError(
      "INVALID",
      "Only active or confirmed plans can be marked done.",
    );
  }
  await db
    .update(plans)
    .set({ status: "done", cancelledAt: null })
    .where(eq(plans.id, plan.id));
}

export async function cancelPlan(input: PlanIdInput): Promise<void> {
  const { plan, userId } = await loadPlanForStatusChange(input);
  if (plan.status !== "active" && plan.status !== "confirmed") {
    throw new ActionError(
      "INVALID",
      "Only active or confirmed plans can be cancelled.",
    );
  }
  await db
    .update(plans)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(eq(plans.id, plan.id));

  const appUrl = await getAppUrl();
  void sendPlanCancelledEmail(plan.id, userId, appUrl).catch((err) => {
    console.error("[plans.cancelPlan] email fanout failed", err);
  });
}

export async function uncancelPlan(input: PlanIdInput): Promise<void> {
  const { plan } = await loadPlanForStatusChange(input);
  if (plan.status !== "cancelled") {
    throw new ActionError(
      "INVALID",
      "This plan isn't cancelled.",
    );
  }
  // Per M13 spec: uncancel always returns to `active`, not `confirmed`.
  // We don't track the pre-cancel status, and the spec excludes "remember
  // was-confirmed through cancel cycle" as out-of-scope.
  await db
    .update(plans)
    .set({ status: "active", cancelledAt: null })
    .where(eq(plans.id, plan.id));
}

export async function confirmPlan(input: PlanIdInput): Promise<void> {
  const { plan, userId } = await loadPlanForStatusChange(input);
  if (plan.status !== "active") {
    throw new ActionError(
      "INVALID",
      plan.status === "confirmed"
        ? "This plan is already confirmed."
        : "Only active plans can be confirmed.",
    );
  }
  await db
    .update(plans)
    .set({ status: "confirmed" })
    .where(eq(plans.id, plan.id));

  const appUrl = await getAppUrl();
  void sendPlanConfirmedEmail(plan.id, userId, appUrl).catch((err) => {
    console.error("[plans.confirmPlan] email fanout failed", err);
  });
}

export async function unconfirmPlan(input: PlanIdInput): Promise<void> {
  const { plan } = await loadPlanForStatusChange(input);
  if (plan.status !== "confirmed") {
    throw new ActionError(
      "INVALID",
      "This plan isn't confirmed.",
    );
  }
  await db
    .update(plans)
    .set({ status: "active" })
    .where(eq(plans.id, plan.id));
}
