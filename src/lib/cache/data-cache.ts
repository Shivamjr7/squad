"use client";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class DataCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

  set<T>(key: string, data: T, ttl: number = this.DEFAULT_TTL): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  invalidate(pattern: string | RegExp): void {
    if (typeof pattern === 'string') {
      this.cache.delete(pattern);
    } else {
      for (const key of this.cache.keys()) {
        if (pattern.test(key)) {
          this.cache.delete(key);
        }
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  // Preload data for likely navigation targets
  preload<T>(key: string, dataLoader: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = this.get<T>(key);
    if (cached) return Promise.resolve(cached);

    return dataLoader().then(data => {
      this.set(key, data, ttl);
      return data;
    });
  }

  // Get or load pattern
  getOrLoad<T>(key: string, dataLoader: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = this.get<T>(key);
    if (cached) return Promise.resolve(cached);

    return dataLoader().then(data => {
      this.set(key, data, ttl);
      return data;
    });
  }
}

export const dataCache = new DataCache();

// Cache key generators
export const cacheKeys = {
  userCircles: (userId: string) => `user:${userId}:circles`,
  circleMembers: (circleId: string) => `circle:${circleId}:members`,
  circlePlans: (circleId: string) => `circle:${circleId}:plans`,
  planDetails: (planId: string) => `plan:${planId}:details`,
  userVotes: (userId: string, planId: string) => `user:${userId}:plan:${planId}:votes`,
  notifications: (userId: string) => `user:${userId}:notifications`,
};
