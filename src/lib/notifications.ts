// Internal notification dispatcher. Called from server actions on the
// trigger side (vote cast, plan create, lock, cancel) and from anywhere
// else that wants to drop a row into a user's feed.
//
// Three responsibilities:
//   1. Insert one row per recipient into the `notifications` table — that's
//      the in-app feed. Read by listNotifications + getUnreadCount.
//   2. Fire-and-forget hand-off to the Supabase Edge Function `send-push`,
//      which fans the same payload out to every push_subscriptions row owned
//      by each recipient. The HTTP call is awaited as a Promise but its
//      errors are swallowed — push delivery must not fail the trigger.
//   3. Resolve "everyone on this plan except the actor" via
//      resolvePlanAudience for the trigger sites.
//
// The pure push-payload composer lives in `./notifications-payload` so the
// Supabase Edge function (Deno) can import it without dragging in DB code.
// We re-export it here so call sites keep importing from `@/lib/notifications`
// as before — single import surface.
//
// We don't use Supabase Database Webhooks for the hand-off because that
// requires manual project-config glue. A direct fetch from the Next.js
// server keeps the wiring inside this repo. Cron-driven notifications
// (plan_leave_soon) skip this module entirely — the edge function inserts
// its own rows and fans out without an HTTP round-trip.

import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships, notifications, planRecipients, users } from "@/db/schema";
import type { NotificationPayload } from "@/lib/notifications-payload";

// Re-export the pure composer + types so existing call sites keep working.
export type {
  ComposeInput,
  ComposeOptions,
  ComposedPushPayload,
  NotificationPayload,
  PlanCancelledPayload,
  PlanConflictPayload,
  PlanConflictResolvedPayload,
  PlanCreatedPayload,
  PlanLeaveSoonPayload,
  PlanLockedPayload,
  PlanReminderPayload,
  PushAction,
  VoteInPayload,
} from "@/lib/notifications-payload";
export {
  composePushPayload,
  DEFAULT_BADGE,
  DEFAULT_ICON,
  PUSH_PAYLOAD_BUDGET_BYTES,
  stripPushPayloadToMinimum,
} from "@/lib/notifications-payload";

export type DispatchInput = NotificationPayload & {
  userIds: string[];
};

export async function dispatchNotifications(
  input: DispatchInput,
): Promise<void> {
  if (input.userIds.length === 0) return;

  // De-dupe defensively in case a caller passes the creator alongside the
  // recipient set.
  const uniqueIds = Array.from(new Set(input.userIds));

  const inserted = await db
    .insert(notifications)
    .values(
      uniqueIds.map((userId) => ({
        userId,
        type: input.type,
        payload: input.payload,
      })),
    )
    .returning({ id: notifications.id });

  if (inserted.length === 0) return;

  // Push fan-out runs on Supabase Edge; the Next.js process only signals it.
  // Fire-and-forget — errors get logged, never thrown, so a downed edge
  // function doesn't take down the trigger.
  void invokeSendPush(inserted.map((r) => r.id));
}

async function invokeSendPush(notificationIds: string[]): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.CRON_SECRET;
  if (!url || !secret) {
    // Local dev or unconfigured deploy — skip silently. The in-app rows are
    // already written so users still see the notification on next page load.
    return;
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ notificationIds }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[notifications] send-push non-2xx", {
        status: res.status,
        body,
      });
    }
  } catch (err) {
    console.warn("[notifications] send-push fetch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Resolves "everyone on this plan except the actor". Plan recipients if the
// row set is non-empty, else full circle membership. Used by the in-app
// trigger sites so they share one definition of audience.
//
// M31 — filters out users with `users.notifications_enabled = false`. The
// global mute (set via /you → Manage devices) is enforced here so muted
// users don't get either an in-app feed row or a push. Permission is on by
// default for every account; this is the opt-out.
export async function resolvePlanAudience(
  planId: string,
  circleId: string,
  excludeUserId: string | null,
): Promise<string[]> {
  const recipientRows = await db
    .select({ userId: planRecipients.userId })
    .from(planRecipients)
    .where(eq(planRecipients.planId, planId));

  let candidateIds: string[];
  if (recipientRows.length > 0) {
    candidateIds = recipientRows.map((r) => r.userId);
    if (excludeUserId) {
      candidateIds = candidateIds.filter((id) => id !== excludeUserId);
    }
  } else {
    const memberRows = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        excludeUserId
          ? and(
              eq(memberships.circleId, circleId),
              ne(memberships.userId, excludeUserId),
            )
          : eq(memberships.circleId, circleId),
      );
    candidateIds = memberRows.map((r) => r.userId);
  }

  if (candidateIds.length === 0) return candidateIds;

  const enabledRows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, candidateIds),
        eq(users.notificationsEnabled, true),
      ),
    );
  return enabledRows.map((r) => r.id);
}
