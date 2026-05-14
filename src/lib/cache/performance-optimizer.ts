"use client";

import React, { useCallback, useRef, useEffect } from "react";

// Performance monitoring utilities
class PerformanceMonitor {
  private metrics = new Map<string, number[]>();
  
  startTimer(key: string): () => void {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      this.recordMetric(key, duration);
    };
  }
  
  private recordMetric(key: string, value: number): void {
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }
    this.metrics.get(key)!.push(value);
    
    // Keep only last 10 measurements
    const values = this.metrics.get(key)!;
    if (values.length > 10) {
      values.shift();
    }
  }
  
  getAverage(key: string): number {
    const values = this.metrics.get(key);
    if (!values || values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }
  
  // Log slow operations
  logSlowOperations(): void {
    for (const [key] of this.metrics.entries()) {
      const avg = this.getAverage(key);
      if (avg > 100) { // Operations taking more than 100ms
        console.warn(`Slow operation detected: ${key} (avg: ${avg.toFixed(2)}ms)`);
      }
    }
  }
}

export const performanceMonitor = new PerformanceMonitor();

// Debounce utility for rapid actions
export function useDebounce<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  return useCallback((...args: unknown[]) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  }, [callback, delay]) as T;
}

// Throttle utility for frequent updates
export function useThrottle<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number
): T {
  const lastCall = useRef<number>(0);
  
  return useCallback((...args: unknown[]) => {
    const now = Date.now();
    if (now - lastCall.current >= delay) {
      lastCall.current = now;
      callback(...args);
    }
  }, [callback, delay]) as T;
}

// Intersection Observer for lazy loading
export function useIntersectionObserver(
  callback: IntersectionObserverCallback,
  options?: IntersectionObserverInit
): (node: Element | null) => void {
  const observer = useRef<IntersectionObserver | null>(null);
  
  useEffect(() => {
    observer.current = new IntersectionObserver(callback, options);
    return () => observer.current?.disconnect();
  }, [callback, options]);
  
  return useCallback((node) => {
    if (node) observer.current?.observe(node);
    else observer.current?.disconnect();
  }, [observer]);
}

// RequestIdleCallback for non-critical updates
export function useIdleCallback<T extends (...args: unknown[]) => unknown>(
  callback: T
): T {
  return useCallback((...args: unknown[]) => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => callback(...args));
    } else {
      setTimeout(() => callback(...args), 1);
    }
  }, [callback]) as T;
}

// Memory usage monitoring
export function useMemoryMonitor(): { memoryUsage: number; isHighMemoryUsage: boolean } {
  const [memoryUsage, setMemoryUsage] = React.useState(0);
  
  useEffect(() => {
    const updateMemory = () => {
      if ('memory' in performance) {
        const memory = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
        if (memory) {
          const used = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
          setMemoryUsage(used);
        }
      }
    };
    
    const interval = setInterval(updateMemory, 5000);
    updateMemory();
    
    return () => clearInterval(interval);
  }, []);
  
  return {
    memoryUsage,
    isHighMemoryUsage: memoryUsage > 0.8,
  };
}
