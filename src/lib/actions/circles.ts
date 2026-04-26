"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, memberships } from "@/db/schema";
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

export type { CreateCircleInput, RenameCircleInput };
