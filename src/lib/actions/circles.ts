"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { circles, memberships, users } from "@/db/schema";
import { requireMembership, requireUserId } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";
import {
  createCircleSchema,
  renameCircleSchema,
  type CreateCircleInput,
  type RenameCircleInput,
} from "@/lib/validation/circle";

export async function createCircle(
  input: CreateCircleInput,
): Promise<{ slug: string }> {
  const userId = await requireUserId();
  const parsed = createCircleSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid circle details.",
    );
  }
  const { name, slug } = parsed.data;

  const existing = await db.query.circles.findFirst({
    columns: { id: true },
    where: eq(circles.slug, slug),
  });
  if (existing) {
    throw new ActionError("CONFLICT", "That URL is already taken.");
  }

  await db.transaction(async (tx) => {
    const [circle] = await tx
      .insert(circles)
      .values({ slug, name, createdBy: userId })
      .returning({ id: circles.id });

    if (!circle) {
      throw new ActionError("INVALID", "Failed to create circle.");
    }

    await tx.insert(memberships).values({
      userId,
      circleId: circle.id,
      role: "admin",
    });
  });

  return { slug };
}

export async function renameCircle(input: {
  circleId: string;
  name: string;
}): Promise<void> {
  await requireMembership(input.circleId, "admin");

  const parsed = renameCircleSchema.safeParse({ name: input.name });
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid circle name.",
    );
  }

  await db
    .update(circles)
    .set({ name: parsed.data.name })
    .where(eq(circles.id, input.circleId));
}

// Direct-add a known Squad user to a circle. Admin-only. Idempotent: a no-op
// if the target is already a member. Used by the "Add directly" list in the
// invite dialog (M17 Fix 3).
export async function addMemberDirectly(input: {
  circleId: string;
  userId: string;
}): Promise<void> {
  await requireMembership(input.circleId, "admin");

  const target = await db.query.users.findFirst({
    columns: { id: true },
    where: eq(users.id, input.userId),
  });
  if (!target) {
    throw new ActionError("NOT_FOUND", "That user isn't on Squad.");
  }

  const existing = await db.query.memberships.findFirst({
    columns: { id: true },
    where: and(
      eq(memberships.userId, input.userId),
      eq(memberships.circleId, input.circleId),
    ),
  });
  if (existing) return;

  await db.insert(memberships).values({
    userId: input.userId,
    circleId: input.circleId,
    role: "member",
  });

  // Refresh the circle's pages so the new member shows up in the strip + lists.
  const circle = await db.query.circles.findFirst({
    columns: { slug: true },
    where: eq(circles.id, input.circleId),
  });
  if (circle?.slug) {
    revalidatePath(`/c/${circle.slug}`);
    revalidatePath(`/c/${circle.slug}/settings`);
  }
}

export type { CreateCircleInput, RenameCircleInput };
