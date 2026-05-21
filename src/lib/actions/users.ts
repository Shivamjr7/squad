"use server";

import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireUserId, USER_DISPLAY_NAME_TAG } from "@/lib/auth";
import { USER_PROFILE_TAG } from "@/lib/server-cache";
import { ActionError } from "@/lib/actions/errors";
import {
  setDisplayNameSchema,
  type SetDisplayNameInput,
} from "@/lib/validation/user";

export async function setDisplayName(input: SetDisplayNameInput): Promise<void> {
  const userId = await requireUserId();
  const parsed = setDisplayNameSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid name.",
    );
  }
  await db
    .update(users)
    .set({
      displayName: parsed.data.displayName,
      hasSetDisplayName: true,
    })
    .where(eq(users.id, userId));
  // Drop the cached flag so the next page render reflects truth and stops
  // bouncing to /set-name. Also drop the profile cache so /you reflects the
  // new name immediately.
  revalidateTag(USER_DISPLAY_NAME_TAG);
  revalidateTag(USER_PROFILE_TAG);
}

// Hard delete: removes the Clerk user (which signs them out everywhere) and
// the Supabase users row. Schema cascades wipe votes, comments, memberships,
// push subscriptions, notifications, and recipient rows (PLAN.md §5). Plans /
// circles created by the user keep their row with created_by set to NULL so
// the rest of the squad still has the plan / circle.
//
// We delete from the DB first so a Clerk failure mid-flight doesn't leave a
// signed-in user with no Supabase row (which would 500 every server page).
// The Clerk webhook (user.deleted) will fire a no-op DB delete afterwards —
// safe because the row is already gone.
export async function deleteAccount(): Promise<void> {
  const userId = await requireUserId();
  await db.delete(users).where(eq(users.id, userId));
  revalidateTag(USER_DISPLAY_NAME_TAG);
  try {
    const client = await clerkClient();
    await client.users.deleteUser(userId);
  } catch (err) {
    // DB row is already gone, so the user is effectively deleted from the
    // app. Surface the Clerk failure so we can investigate, but don't undo
    // the DB delete.
    throw new ActionError(
      "INVALID",
      err instanceof Error
        ? `Account data deleted, but Clerk sign-out failed: ${err.message}`
        : "Account data deleted, but Clerk sign-out failed.",
    );
  }
}
