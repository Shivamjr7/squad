"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import {
  circles,
  memberships,
  planRecipients,
  plans,
} from "@/db/schema";
import { canModifyPlan, requireMembership } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";
import {
  addPlanRecipientsSchema,
  type AddPlanRecipientsInput,
} from "@/lib/validation/plan-recipient";

// M23 — resolve the recipient set for a plan. Returns the explicit user-id
// list and an isAll flag. isAll = true means no rows in plan_recipients,
// which by convention represents "everyone in the circle" (back-compat path
// for pre-M23 plans + the "ALL" chip in the create form).
export async function getPlanRecipientIds(
  planId: string,
): Promise<{ userIds: string[]; isAll: boolean }> {
  const rows = await db
    .select({ userId: planRecipients.userId })
    .from(planRecipients)
    .where(eq(planRecipients.planId, planId));
  if (rows.length === 0) return { userIds: [], isAll: true };
  return { userIds: rows.map((r) => r.userId), isAll: false };
}

// Mid-flight recipient add — creator or any circle admin (PLAN.md §10 M23).
// "isAll" plans (no recipient rows yet) become explicit on the first add: we
// snapshot the current circle membership into plan_recipients alongside the
// new ids, otherwise the next call would silently drop existing members from
// the implicit set. Idempotent on conflict so concurrent adds are safe.
export async function addPlanRecipients(
  input: AddPlanRecipientsInput,
): Promise<void> {
  const parsed = addPlanRecipientsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid input.",
    );
  }
  const { planId, userIds } = parsed.data;

  const plan = await db.query.plans.findFirst({
    columns: {
      id: true,
      circleId: true,
      createdBy: true,
    },
    where: eq(plans.id, planId),
  });
  if (!plan) throw new ActionError("NOT_FOUND", "Plan not found.");

  const { userId, role } = await requireMembership(plan.circleId);
  if (!canModifyPlan(plan, userId, { role })) {
    throw new ActionError(
      "FORBIDDEN",
      "Only the plan's creator or a circle admin can add recipients.",
    );
  }

  // Validate: every requested id is a member of the plan's circle.
  const memberRows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.circleId, plan.circleId),
        inArray(memberships.userId, userIds),
      ),
    );
  const memberIds = new Set(memberRows.map((m) => m.userId));
  const requested = Array.from(new Set(userIds));
  if (requested.some((id) => !memberIds.has(id))) {
    throw new ActionError(
      "INVALID",
      "One or more users aren't in this circle.",
    );
  }

  // Existing rows. Empty = implicit-full-circle plan; we'll need to seed.
  const existing = await db
    .select({ userId: planRecipients.userId })
    .from(planRecipients)
    .where(eq(planRecipients.planId, planId));

  const insertSet = new Set<string>(requested);
  if (existing.length === 0) {
    // Snapshot the current circle so the implicit set doesn't collapse.
    const allMembers = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.circleId, plan.circleId));
    for (const m of allMembers) insertSet.add(m.userId);
  }

  if (insertSet.size > 0) {
    await db
      .insert(planRecipients)
      .values(
        Array.from(insertSet).map((uid) => ({ planId, userId: uid })),
      )
      .onConflictDoNothing({
        target: [planRecipients.planId, planRecipients.userId],
      });
  }

  const circle = await db.query.circles.findFirst({
    columns: { slug: true },
    where: eq(circles.id, plan.circleId),
  });
  if (circle?.slug) {
    revalidatePath(`/c/${circle.slug}/p/${planId}`);
    revalidatePath(`/c/${circle.slug}`);
  }
}
