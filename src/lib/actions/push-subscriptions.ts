"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";
import {
  pushSubscriptionSchema,
  type PushSubscriptionInput,
} from "@/lib/validation/push-subscription";

export async function setPushSubscription(
  input: PushSubscriptionInput,
): Promise<void> {
  const userId = await requireUserId();
  const parsed = pushSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid push subscription.",
    );
  }
  await db
    .update(users)
    .set({ pushSubscription: parsed.data })
    .where(eq(users.id, userId));
}

export async function clearPushSubscription(): Promise<void> {
  const userId = await requireUserId();
  await db
    .update(users)
    .set({ pushSubscription: null })
    .where(eq(users.id, userId));
}
