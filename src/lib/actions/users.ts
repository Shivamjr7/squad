"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
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
}
