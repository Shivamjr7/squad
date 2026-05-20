import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { users, plans } from "@/db/schema";

/**
 * Batch loader for avoiding N+1 queries
 * Load multiple items at once and cache results
 */
const loaderCache = new Map<string, Map<unknown, unknown>>();

function getOrCreateCache(key: string) {
  if (!loaderCache.has(key)) {
    loaderCache.set(key, new Map());
  }
  return loaderCache.get(key)!;
}

export async function batchLoadUsers(userIds: string[]) {
  const cache = getOrCreateCache("users");
  const missing = userIds.filter(id => !cache.has(id));

  if (missing.length > 0) {
    const loaded = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        email: users.email,
      })
      .from(users)
      .where(inArray(users.id, missing));

    for (const user of loaded) {
      cache.set(user.id, user);
    }
  }

  return userIds.map(id => cache.get(id));
}

export async function batchLoadPlans(planIds: string[]) {
  const cache = getOrCreateCache("plans");
  const missing = planIds.filter(id => !cache.has(id));

  if (missing.length > 0) {
    const loaded = await db
      .select()
      .from(plans)
      .where(inArray(plans.id, missing));

    for (const plan of loaded) {
      cache.set(plan.id, plan);
    }
  }

  return planIds.map(id => cache.get(id));
}

// Clear cache between requests if needed
export function clearBatchCache() {
  loaderCache.clear();
}
