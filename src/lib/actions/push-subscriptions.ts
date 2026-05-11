"use server";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
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
}

// Unsubscribe is endpoint-scoped. The browser passes the endpoint of the
// subscription it just unsubscribed; we delete only that row so the user's
// other devices keep receiving pushes.
export async function clearPushSubscription(
  input: UnsubscribePushInput,
): Promise<void> {
  await requireUserId();
  const parsed = unsubscribePushSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid endpoint.",
    );
  }
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, parsed.data.endpoint));
}
