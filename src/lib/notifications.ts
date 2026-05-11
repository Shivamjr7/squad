// Internal notification dispatcher. Called from server actions on the
// trigger side (vote cast, plan create) and from anywhere else that wants to
// drop a row into a user's feed. Two responsibilities:
//
//   1. Insert one row per recipient into the `notifications` table — that's
//      the in-app feed. Read by listNotifications + getUnreadCount.
//   2. Fire-and-forget hand-off to the Supabase Edge Function `send-push`,
//      which fans the same payload out to every push_subscriptions row owned
//      by each recipient. The HTTP call is awaited as a Promise but its
//      errors are swallowed — push delivery must not fail the trigger.
//
// We don't use Supabase Database Webhooks for the hand-off because that
// requires manual project-config glue. A direct fetch from the Next.js
// server keeps the wiring inside this repo. Cron-driven notifications
// (plan_reminder) skip this module entirely — the edge function inserts
// its own rows and fans out without an HTTP round-trip.

import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships, notifications, planRecipients } from "@/db/schema";

// Payload shapes, one per notification type. The dispatcher accepts a
// discriminated union so the call site can't assemble a `vote_in` payload
// with reminder fields.
export type NotificationPayload =
  | {
      type: "vote_in";
      payload: {
        planId: string;
        planTitle: string;
        circleSlug: string;
        circleName: string;
        voterName: string;
        voterId: string;
      };
    }
  | {
      type: "plan_created";
      payload: {
        planId: string;
        planTitle: string;
        circleSlug: string;
        circleName: string;
        creatorName: string;
        creatorId: string;
      };
    }
  | {
      type: "plan_reminder";
      payload: {
        planId: string;
        planTitle: string;
        circleSlug: string;
        circleName: string;
        // ISO string — formatter lives client-side so the recipient's locale
        // wins. Server-rendered fallback uses EMAIL_TIMEZONE.
        startsAtIso: string;
        location: string | null;
      };
    };

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
export async function resolvePlanAudience(
  planId: string,
  circleId: string,
  excludeUserId: string | null,
): Promise<string[]> {
  const recipientRows = await db
    .select({ userId: planRecipients.userId })
    .from(planRecipients)
    .where(eq(planRecipients.planId, planId));

  if (recipientRows.length > 0) {
    const ids = recipientRows.map((r) => r.userId);
    if (!excludeUserId) return ids;
    return ids.filter((id) => id !== excludeUserId);
  }

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
  return memberRows.map((r) => r.userId);
}
