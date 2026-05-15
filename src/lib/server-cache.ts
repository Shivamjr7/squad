import { unstable_cache as cache } from "next/cache";

/**
 * Server-side caching with longer TTLs than request-scoped cache()
 * These are revalidated based on tags or time intervals
 */

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
  async (userId: string) => {
    const { getUnreadCount } = await import("./actions/notifications");
    return getUnreadCount();
  },
  ["unread-count"],
  { 
    revalidate: 30,
    tags: ["unread-count"] 
  }
);
