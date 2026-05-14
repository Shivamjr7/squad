"use client";

import { useEffect, useRef } from "react";
import { dataCache } from "./data-cache";

interface PreloadConfig {
  key: string;
  loader: () => Promise<unknown>;
  priority: "high" | "medium" | "low";
  ttl?: number;
}

class PreloadManager {
  private preloaded = new Set<string>();
  private preloadQueue: PreloadConfig[] = [];
  private isProcessing = false;

  // Add to preload queue
  add(config: PreloadConfig): void {
    if (this.preloaded.has(config.key)) return;
    
    this.preloadQueue.push(config);
    this.preloadQueue.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.preloadQueue.length === 0) return;
    
    this.isProcessing = true;
    
    while (this.preloadQueue.length > 0) {
      const config = this.preloadQueue.shift()!;
      
      try {
        await dataCache.preload(config.key, config.loader, config.ttl);
        this.preloaded.add(config.key);
      } catch (error) {
        console.warn(`Failed to preload ${config.key}:`, error);
      }
      
      // Small delay to prevent blocking main thread
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    this.isProcessing = false;
  }

  // Preload based on user behavior patterns
  preloadLikelyNavigation(currentPath: string, userId: string): void {
    // Preload common navigation targets based on current path
    if (currentPath.includes('/c/')) {
      // User is in a circle, preload related data
      const slug = currentPath.split('/')[2];
      
      this.add({
        key: `circle:${slug}:plans`,
        loader: () => fetch(`/api/circles/${slug}/plans`).then(r => r.json()),
        priority: "high",
        ttl: 2 * 60 * 1000, // 2 minutes
      });
      
      this.add({
        key: `circle:${slug}:members`,
        loader: () => fetch(`/api/circles/${slug}/members`).then(r => r.json()),
        priority: "medium",
        ttl: 10 * 60 * 1000, // 10 minutes
      });
    }
    
    // Always preload user's circles
    this.add({
      key: `user:${userId}:circles`,
      loader: () => fetch('/api/user/circles').then(r => r.json()),
      priority: "high",
      ttl: 5 * 60 * 1000,
    });
  }

  // Preload on hover (for navigation links)
  preloadOnHover(key: string, loader: () => Promise<unknown>, ttl?: number): void {
    this.add({
      key,
      loader,
      priority: "medium",
      ttl,
    });
  }
}

export const preloadManager = new PreloadManager();

// Hook for automatic preloading
export function usePreloader(currentPath: string, userId: string) {
  const hasPreloaded = useRef(false);
  
  useEffect(() => {
    if (!hasPreloaded.current) {
      preloadManager.preloadLikelyNavigation(currentPath, userId);
      hasPreloaded.current = true;
    }
  }, [currentPath, userId]);
}
