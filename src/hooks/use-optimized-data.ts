"use client";

import { useState, useEffect, useCallback } from "react";
import { dataCache, cacheKeys } from "@/lib/cache/data-cache";
import { performanceMonitor } from "@/lib/cache/performance-optimizer";
import { dedupedFetch } from "@/lib/cache/request-dedup";
import type { UserCircle } from "@/lib/circle-types";

interface UseOptimizedDataOptions<T> {
  key: string;
  fetcher: () => Promise<T>;
  ttl?: number;
  staleWhileRevalidate?: boolean;
  revalidateOnFocus?: boolean;
  revalidateOnReconnect?: boolean;
}

export function useOptimizedData<T>({
  key,
  fetcher,
  ttl = 5 * 60 * 1000, // 5 minutes default
  staleWhileRevalidate = true,
  revalidateOnFocus = true,
  revalidateOnReconnect = true,
}: UseOptimizedDataOptions<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async (force = false) => {
    const endTimer = performanceMonitor.startTimer(`fetch:${key}`);
    
    try {
      setLoading(true);
      setError(null);

      // Try cache first unless forcing refresh
      if (!force) {
        const cached = dataCache.get<T>(key);
        if (cached) {
          setData(cached);
          setLoading(false);
          endTimer();
          return cached;
        }
      }

      // Fetch fresh data
      const freshData = await fetcher();
      dataCache.set(key, freshData, ttl);
      setData(freshData);
      return freshData;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Fetch failed');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
      endTimer();
    }
  }, [key, fetcher, ttl]);

  // Initial fetch
  useEffect(() => {
    fetchData().catch(console.error);
  }, [fetchData]);

  // Revalidate on window focus
  useEffect(() => {
    if (!revalidateOnFocus) return;

    const handleFocus = () => {
      // Stale-while-revalidate: don't show loading state
      if (staleWhileRevalidate && data) {
        fetchData().catch(console.error);
      } else {
        fetchData(true).catch(console.error);
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [revalidateOnFocus, staleWhileRevalidate, data, fetchData]);

  // Revalidate on reconnect
  useEffect(() => {
    if (!revalidateOnReconnect) return;

    const handleOnline = () => {
      if (staleWhileRevalidate && data) {
        fetchData().catch(console.error);
      } else {
        fetchData(true).catch(console.error);
      }
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [revalidateOnReconnect, staleWhileRevalidate, data, fetchData]);

  // Manual revalidation
  const revalidate = useCallback(() => fetchData(true), [fetchData]);

  // Optimistic update
  const updateData = useCallback((updater: (current: T | null) => T) => {
    setData(prev => {
      const newData = updater(prev);
      dataCache.set(key, newData, ttl);
      return newData;
    });
  }, [key, ttl]);

  return {
    data,
    loading,
    error,
    revalidate,
    updateData,
  };
}

// Specific hooks for common data patterns
export function useUserCircles(userId: string) {
  return useOptimizedData<UserCircle[]>({
    key: cacheKeys.userCircles(userId),
    fetcher: async () => {
      return dedupedFetch<UserCircle[]>('/api/user/circles');
    },
    ttl: 10 * 60 * 1000, // 10 minutes
  });
}

export type CircleMemberResponse = Array<{
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  joinedAt: string;
}>;

export function useCircleMembers(circleId: string) {
  return useOptimizedData<CircleMemberResponse>({
    key: cacheKeys.circleMembers(circleId),
    fetcher: async () => {
      return dedupedFetch<CircleMemberResponse>(`/api/circles/${circleId}/members`);
    },
    ttl: 15 * 60 * 1000, // 15 minutes
  });
}

export function useCirclePlans(circleId: string) {
  return useOptimizedData<unknown[]>({
    key: cacheKeys.circlePlans(circleId),
    fetcher: async () => {
      return dedupedFetch<unknown[]>(`/api/circles/${circleId}/plans`);
    },
    ttl: 2 * 60 * 1000, // 2 minutes - plans change frequently
  });
}

export type NotificationsResponse = {
  unreadCount: number;
  timestamp: string;
};

export function useNotifications(userId: string) {
  return useOptimizedData<NotificationsResponse>({
    key: cacheKeys.notifications(userId),
    fetcher: async () => {
      return dedupedFetch<NotificationsResponse>('/api/notifications');
    },
    ttl: 30 * 1000, // 30 seconds - notifications need to be fresh
  });
}
