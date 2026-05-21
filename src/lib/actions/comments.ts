"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { comments, plans } from "@/db/schema";
import { requireMembership, requirePlanRecipient, requireUserId } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";
import {
  addCommentSchema,
  deleteCommentSchema,
  type AddCommentInput,
  type DeleteCommentInput,
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
  await requirePlanRecipient(data.planId, userId);

  const [row] = await db
    .insert(comments)
    .values({ planId: data.planId, userId, body: data.body })
    .returning();
  if (!row) {
    throw new ActionError("INVALID", "Couldn't save comment.");
  }

  // Comments don't generate notifications in M31 — keeps the feed quiet.
  // Realtime channel still delivers the live update to anyone viewing the
  // plan detail; out-of-app discovery happens via the plan_locked /
  // plan_leave_soon pushes the recipient already gets.

  return {
    id: row.id,
    planId: row.planId,
    userId: row.userId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function deleteComment(input: DeleteCommentInput): Promise<void> {
  const parsed = deleteCommentSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError("INVALID", "Invalid comment.");
  }
  const userId = await requireUserId();

  // Author-only delete. Match by (id, userId) so a non-author gets NOT_FOUND
  // even if the row exists — no info leak about other people's comments.
  const result = await db
    .delete(comments)
    .where(and(eq(comments.id, parsed.data.commentId), eq(comments.userId, userId)))
    .returning({ id: comments.id });

  if (result.length === 0) {
    throw new ActionError(
      "NOT_FOUND",
      "Couldn't delete — comment is gone or isn't yours.",
    );
  }
}
