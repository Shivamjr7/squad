import { unstable_cache as cache } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { pushSubscriptions, users } from "@/db/schema";

/**
 * Server-side caching with longer TTLs than request-scoped cache()
 * These are revalidated based on tags or time intervals
 */

export const USER_PROFILE_TAG = "user-profile";
export const USER_DEVICES_TAG = "user-devices";

// Profile fields shown on the circle-agnostic /you tab. Cached by userId
// because the You tab is meant to read identically across every circle the
// user belongs to. Invalidated via the USER_PROFILE_TAG from the display-name
// + clerk-webhook write paths.
export const getCachedUserProfile = cache(
  async (userId: string) => {
    return db.query.users.findFirst({
      columns: { displayName: true, email: true, avatarUrl: true },
      where: eq(users.id, userId),
    });
  },
  ["user-profile"],
  { revalidate: 300, tags: [USER_PROFILE_TAG] },
);

// Push-subscription rows powering the Manage devices section. Cached on
// userId; invalidated from subscribe / unsubscribe / 410-cleanup paths so
// the list flips immediately when a device is added or revoked.
//
// Dates are serialized to ISO strings inside the cache fn because
// `unstable_cache` JSON-serializes the return value — Date objects come
// back out as strings, and the consumer was calling `.toISOString()` on
// what it thought was still a Date. We do the conversion here once so
// the consumer sees a stable string-shaped row regardless of cache hit.
export const getCachedUserDevices = cache(
  async (userId: string) => {
    const rows = await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        deviceHint: pushSubscriptions.deviceHint,
        lastUsedAt: pushSubscriptions.lastUsedAt,
        createdAt: pushSubscriptions.createdAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    return rows.map((r) => ({
      id: r.id,
      endpoint: r.endpoint,
      deviceHint: r.deviceHint,
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  },
  ["user-devices"],
  { revalidate: 60, tags: [USER_DEVICES_TAG] },
);

export const getCachedUserCircles = cache(
  async (userId: string) => {
    const { getUserCircles } = await import("./circles");
    return getUserCircles(userId);
  },
  ["user-circles"], // cache key prefix
  { 
    revalidate: 60, // 60 seconds
    tags: ["user-circles"] 
  }
);

export const getCachedCircleBySlug = cache(
  async (slug: string) => {
    const { getCircleBySlug } = await import("./circles");
    return getCircleBySlug(slug);
  },
  ["circle-slug"],
  { 
    revalidate: 300, // 5 minutes
    tags: ["circle-slug"] 
  }
);

export const getCachedCircleMembers = cache(
  async (circleId: string) => {
    const { getCircleMembers } = await import("./circles");
    return getCircleMembers(circleId);
  },
  ["circle-members"],
  { 
    revalidate: 60,
    tags: ["circle-members"] 
  }
);

export const getCachedCircleMemberActivity = cache(
  async (circleId: string) => {
    const { getCircleMemberActivity } = await import("./circles");
    return getCircleMemberActivity(circleId);
  },
  ["circle-activity"],
  { 
    revalidate: 30,
    tags: ["circle-activity"] 
  }
);

export const getCachedUnreadCount = cache(
  // userId arg is what `unstable_cache` hashes into the cache key so two
  // signed-in users don't share an entry — the underlying server action
  // pulls the id from auth() itself, so it isn't referenced in the body.
  async (userId: string) => {
    void userId;
    const { getUnreadCount } = await import("./actions/notifications");
    return getUnreadCount();
  },
  ["unread-count"],
  {
    revalidate: 30,
    tags: ["unread-count"],
  },
);
