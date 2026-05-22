"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { db } from "@/db/client";
import { pushSubscriptions, users } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { USER_DEVICES_TAG, USER_PROFILE_TAG } from "@/lib/server-cache";
import { ActionError } from "@/lib/actions/errors";
import { takeToken, RATE } from "@/lib/rate-limit";
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
//
// Hijack defense: if the endpoint already exists but is bound to a
// different user, drop the old row first instead of rebinding via
// onConflictDoUpdate. Endpoints are issued by the push service and not
// guessable, but a shared device (browser reset between users, kiosk)
// can legitimately re-register the same endpoint under a new user — we
// want the new user to get their own row, not silently inherit the old
// user's binding.
export async function setPushSubscription(
  input: SubscribePushInput,
): Promise<void> {
  const userId = await requireUserId();
  await takeToken({
    action: "pushSubscribe",
    key: userId,
    ...RATE.pushSubscribe,
  });
  const parsed = subscribePushSchema.safeParse(input);
  if (!parsed.success) {
    throw new ActionError(
      "INVALID",
      parsed.error.issues[0]?.message ?? "Invalid push subscription.",
    );
  }
  const { subscription, deviceHint } = parsed.data;
  const now = new Date();

  const existing = await db.query.pushSubscriptions.findFirst({
    columns: { userId: true },
    where: eq(pushSubscriptions.endpoint, subscription.endpoint),
  });
  if (existing && existing.userId !== userId) {
    await db
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
  }

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
        // Constrained by the delete above: we only hit this branch when
        // the existing row already belongs to this user, so rebinding
        // userId is a no-op.
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

// Global mute — wipes every push subscription row the caller owns. Each
// device's own browser-side PushSubscription object stays valid until it
// tries to send (the next push to that endpoint will come back 410 and the
// row is already gone, so nothing to clean up server-side). The Manage
// devices toggle on /you no longer surfaces this; it's kept for callers
// that want hard subscription removal rather than the column-level mute.
export async function clearAllMyPushSubscriptions(): Promise<void> {
  const userId = await requireUserId();
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  revalidateTag(USER_DEVICES_TAG);
}

// Global mute toggle — flips `users.notifications_enabled`. False = no in-app
// feed rows + no pushes (resolvePlanAudience filters muted users out). True =
// receive normally. Distinct from clearAllMyPushSubscriptions: this leaves
// push_subscriptions rows in place so unmuting doesn't require re-prompting
// for OS permission per device.
export async function setNotificationsEnabled(
  enabled: boolean,
): Promise<void> {
  const userId = await requireUserId();
  await db
    .update(users)
    .set({ notificationsEnabled: enabled })
    .where(eq(users.id, userId));
  revalidateTag(USER_PROFILE_TAG);
}
