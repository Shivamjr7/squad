"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, plans, votes } from "@/db/schema";
import { requireMembership } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";
import {
  createPlanSchema,
  type CreatePlanInput,
} from "@/lib/validation/plan";
import { isValidTimeZone, zonedWallClockToUtc } from "@/lib/tz";

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
        startsAt,
        isApproximate: data.isApproximate,
        location: data.location,
        maxPeople: data.maxPeople,
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

    return plan.id;
  });

  return { planId, slug: circle.slug };
}
