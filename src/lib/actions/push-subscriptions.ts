"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { USER_DEVICES_TAG } from "@/lib/server-cache";
import { ActionError } from "@/lib/actions/errors";
import {
  subscribePushSchema,
  unsubscribePushSchema,
  type SubscribePushInput,
  type UnsubscribePushInput,
} from "@/lib/validation/push-subscription";

// Upsert by `endpoint`. When a known endpoint comes back (same browser, same
// VAPID key), refresh keys + last_used_at so the row tracks the most recent
// successful subscribe. New endpoints insert as fresh rows — never delete
// other rows for the same user, since that's how multi-device support works.
export async function setPushSubscription(
  input: SubscribePushInput,
): Promise<void> {
  const userId = await requireUserId();
  const parsed = subscribePushSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid push subscription.",
    );
  }
  const { subscription, deviceHint } = parsed.data;
  const now = new Date();
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      deviceHint: deviceHint ?? null,
      lastUsedAt: now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        deviceHint: sql`COALESCE(${pushSubscriptions.deviceHint}, EXCLUDED.device_hint)`,
        lastUsedAt: now,
      },
    });
  revalidateTag(USER_DEVICES_TAG);
}

// Unsubscribe is endpoint-scoped. The browser passes the endpoint of the
// subscription it just unsubscribed; we delete only that row so the user's
// other devices keep receiving pushes. Scoped to the caller's user_id so
// nobody can poke at someone else's row by knowing the endpoint string.
export async function clearPushSubscription(
  input: UnsubscribePushInput,
): Promise<void> {
  const userId = await requireUserId();
  const parsed = unsubscribePushSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid endpoint.",
    );
  }
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, parsed.data.endpoint),
        eq(pushSubscriptions.userId, userId),
      ),
    );
  revalidateTag(USER_DEVICES_TAG);
}

// Global mute — wipes every push subscription row the caller owns. Used by
// the Manage devices "Mute all devices" affordance on /you. Each device's
// own browser-side PushSubscription object stays valid until it tries to
// send (the next push to that endpoint will come back 410 and the row is
// already gone, so nothing to clean up server-side).
export async function clearAllMyPushSubscriptions(): Promise<void> {
  const userId = await requireUserId();
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  revalidateTag(USER_DEVICES_TAG);
}
