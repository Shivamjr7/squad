"use server";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, type notificationType } from "@/db/schema";
import { requireUserId } from "@/lib/auth";
import { ActionError } from "@/lib/actions/errors";

// Keep this in sync with the notification_type enum in schema.ts. Cast for
// the consumer side; insert paths route through the lib/notifications.ts
// dispatcher which writes the kind-specific payload shape.
export type NotificationType = (typeof notificationType.enumValues)[number];

export type NotificationRow = {
  id: string;
  type: NotificationType;
  // Payload shape varies by type — UI narrows on `type`.
  payload: Record<string, unknown> | null;
  readAt: Date | null;
  createdAt: Date;
};

const FEED_LIMIT = 50;

export async function listNotifications(): Promise<NotificationRow[]> {
  const userId = await requireUserId();
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      payload: notifications.payload,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(FEED_LIMIT);
  return rows.map((r) => ({
    id: r.id,
    type: r.type as NotificationType,
    payload: (r.payload as Record<string, unknown> | null) ?? null,
    readAt: r.readAt,
    createdAt: r.createdAt,
  }));
}

export async function getUnreadCount(): Promise<number> {
  const userId = await requireUserId();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(eq(notifications.userId, userId), isNull(notifications.readAt)),
    );
  return Number(row?.n ?? 0);
}

export async function markNotificationRead(id: string): Promise<void> {
  const userId = await requireUserId();
  if (!id || typeof id !== "string") {
    throw new ActionError("INVALID", "Missing notification id.");
  }
  // Scoped to user_id so a stray ID can't read-flip someone else's row.
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(eq(notifications.id, id), eq(notifications.userId, userId)),
    );
}

export async function markAllNotificationsRead(): Promise<void> {
  const userId = await requireUserId();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(eq(notifications.userId, userId), isNull(notifications.readAt)),
    );
}
