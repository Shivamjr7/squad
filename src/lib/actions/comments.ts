"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { comments, plans } from "@/db/schema";
import { requireMembership } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";
import {
  addCommentSchema,
  type AddCommentInput,
} from "@/lib/validation/comment";

export type AddedComment = {
  id: string;
  planId: string;
  userId: string;
  body: string;
  createdAt: string;
};

export async function addComment(
  input: AddCommentInput,
): Promise<AddedComment> {
  const parsed = addCommentSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid comment.",
    );
  }
  const data = parsed.data;

  const plan = await db.query.plans.findFirst({
    columns: { circleId: true },
    where: eq(plans.id, data.planId),
  });
  if (!plan) {
    throw new ActionError("NOT_FOUND", "Plan not found.");
  }

  const { userId } = await requireMembership(plan.circleId);

  const [row] = await db
    .insert(comments)
    .values({ planId: data.planId, userId, body: data.body })
    .returning();
  if (!row) {
    throw new ActionError("INVALID", "Couldn't save comment.");
  }

  return {
    id: row.id,
    planId: row.planId,
    userId: row.userId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}
