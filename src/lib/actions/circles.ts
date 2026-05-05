"use server";

import { and, eq, ne } from "drizzle-orm";
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

export async function removeMember(input: {
  circleId: string;
  userId: string;
}): Promise<void> {
  const { userId: callerId } = await requireMembership(input.circleId, "admin");

  if (callerId === input.userId) {
    throw new ActionError(
      "INVALID",
      "Use 'Leave circle' to remove yourself.",
    );
  }

  const target = await db.query.memberships.findFirst({
    columns: { id: true },
    where: and(
      eq(memberships.userId, input.userId),
      eq(memberships.circleId, input.circleId),
    ),
  });
  if (!target) return;

  await db.delete(memberships).where(eq(memberships.id, target.id));

  const circle = await db.query.circles.findFirst({
    columns: { slug: true },
    where: eq(circles.id, input.circleId),
  });
  if (circle?.slug) {
    revalidatePath(`/c/${circle.slug}`);
    revalidatePath(`/c/${circle.slug}/squad`);
    revalidatePath(`/c/${circle.slug}/settings`);
  }
}

export async function leaveCircle(input: {
  circleId: string;
}): Promise<void> {
  const { userId, role } = await requireMembership(input.circleId);

  if (role === "admin") {
    const otherAdmins = await db.query.memberships.findFirst({
      columns: { id: true },
      where: and(
        eq(memberships.circleId, input.circleId),
        eq(memberships.role, "admin"),
        ne(memberships.userId, userId),
      ),
    });
    if (!otherAdmins) {
      throw new ActionError(
        "INVALID",
        "You're the last admin — promote someone else first.",
      );
    }
  }

  await db
    .delete(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.circleId, input.circleId),
      ),
    );

  const circle = await db.query.circles.findFirst({
    columns: { slug: true },
    where: eq(circles.id, input.circleId),
  });
  if (circle?.slug) {
    revalidatePath(`/c/${circle.slug}`);
    revalidatePath(`/c/${circle.slug}/squad`);
  }
}

export type { CreateCircleInput, RenameCircleInput };
