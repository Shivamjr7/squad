"use client";

/**
 * Request deduplication for concurrent API calls
 * If the same request is made multiple times concurrently, return the same cached promise
 */

const requestCache = new Map<string, Promise<unknown>>();
const requestTimeouts = new Map<string, NodeJS.Timeout>();

function getCacheKey(url: string): string {
  // Normalize URL for caching
  return url;
}

export function dedupedFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const cacheKey = getCacheKey(url);

  // If request is already in flight, return the same promise
  if (requestCache.has(cacheKey)) {
    return requestCache.get(cacheKey) as Promise<T>;
  }

  // Make the request and cache the promise
  const promise = fetch(url, init)
    .then(res => {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return res.json() as Promise<T>;
    })
    .catch(error => {
      // Remove from cache on error so retry is attempted
      requestCache.delete(cacheKey);
      throw error;
    });

  requestCache.set(cacheKey, promise);

  // Clean up cache after 100ms to allow final subscribers
  const timeout = setTimeout(() => {
    requestCache.delete(cacheKey);
  }, 100);

  requestTimeouts.set(cacheKey, timeout);

  return promise;
}

// Clear cache for a specific URL or pattern
export function invalidateCache(pattern: string | RegExp): void {
  if (typeof pattern === 'string') {
    const timeout = requestTimeouts.get(pattern);
    if (timeout) clearTimeout(timeout);
    requestCache.delete(pattern);
    requestTimeouts.delete(pattern);
  } else {
    for (const [key] of requestCache) {
      if (pattern.test(key)) {
        const timeout = requestTimeouts.get(key);
        if (timeout) clearTimeout(timeout);
        requestCache.delete(key);
        requestTimeouts.delete(key);
      }
    }
  }
}

export function clearAllCaches(): void {
  for (const timeout of requestTimeouts.values()) {
    clearTimeout(timeout);
  }
  requestCache.clear();
  requestTimeouts.clear();
}
