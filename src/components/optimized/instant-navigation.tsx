"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

export function useInstantNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const [navigationState, setNavigationState] = useState<Record<string, boolean>>({});
  const navigationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Preload components for likely navigation targets
  const preloadComponent = useCallback(async (path: string) => {
    if (navigationState[path]) return;

    const startTime = performance.now();
    
    try {
// Preload the component module for the path
      // This helps the router be ready when navigation happens
      if (path.includes('/plans')) {
        void import('@/app/c/[slug]/(shell)/plans/page');
      } else if (path.includes('/squad')) {
        void import('@/app/c/[slug]/(shell)/squad/page');
      } else if (path.includes('/notifications')) {
        void import('@/app/c/[slug]/(shell)/notifications/page');
      } else if (path.includes('/you')) {
        void import('@/app/c/[slug]/(shell)/you/page');
      } else if (path.includes('/settings')) {
        void import('@/app/c/[slug]/(shell)/settings/page');
      } else {
        // Default home page
        void import('@/app/c/[slug]/(shell)/page');
      }

      setNavigationState(prev => ({
        ...prev,
        [path]: true
      }));
    } catch (error) {
      console.error(`Failed to preload component for ${path}:`, error);
    } finally {
      const duration = performance.now() - startTime;
      console.log(`Preloaded ${path} in ${duration.toFixed(2)}ms`);
    }
  }, [navigationState]);

  // Instant navigation with preloaded components
  const navigateInstant = useCallback((path: string) => {
    // Update URL without full page reload
    router.push(path, { scroll: false });
    
    // If component is preloaded, show it immediately
    if (navigationState[path]) {
      // Component is ready
      console.log(`Instant navigation to ${path}`);
    } else {
      // Fallback to regular navigation
      preloadComponent(path);
    }
  }, [router, navigationState, preloadComponent]);

  // Preload on hover
  const preloadOnHover = useCallback((path: string) => {
    if (navigationTimeoutRef.current) {
      clearTimeout(navigationTimeoutRef.current);
    }
    
    navigationTimeoutRef.current = setTimeout(() => {
      preloadComponent(path);
    }, 100); // Small delay to avoid preloading on accidental hovers
  }, [preloadComponent]);

  // Preload common navigation targets
  useEffect(() => {
    const currentSlug = pathname.split('/')[2];
    if (!currentSlug) return;

    const commonPaths = [
      `/c/${currentSlug}`,
      `/c/${currentSlug}/plans`,
      `/c/${currentSlug}/squad`,
      `/c/${currentSlug}/notifications`,
      `/c/${currentSlug}/you`,
    ];

    // Preload with priority based on likelihood
    const preloadWithDelay = (path: string, delay: number) => {
      setTimeout(() => preloadComponent(path), delay);
    };

    // Immediate preload for current path
    preloadComponent(pathname);
    
    // Preload other paths with delays
    commonPaths.forEach(path => {
      if (path !== pathname) {
        const priority = path === `/c/${currentSlug}` ? 200 : 500;
        preloadWithDelay(path, priority);
      }
    });

    return () => {
      if (navigationTimeoutRef.current) {
        clearTimeout(navigationTimeoutRef.current);
      }
    };
  }, [pathname, preloadComponent]);

  return {
    navigationState,
    navigateInstant,
    preloadOnHover,
    preloadComponent,
  };
}

// Component for instant tab switching
interface TabConfig {
  key: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }> | React.FC<{ className?: string }>;
}

export function InstantTabSwitcher({
  activeTab,
  tabs,
}: {
  activeTab: string;
  tabs: Array<TabConfig>;
}) {
  const { navigateInstant, preloadOnHover } = useInstantNavigation();

  return (
    <div className="flex items-center gap-1 border-b border-ink/10">
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab;
        const Icon = tab.icon;
        
        return (
          <button
            key={tab.key}
            onClick={() => navigateInstant(tab.href)}
            onMouseEnter={() => preloadOnHover(tab.href)}
            className={`
              relative px-4 py-2 text-sm font-medium transition-colors
              ${isActive 
                ? 'text-ink border-b-2 border-coral' 
                : 'text-ink-muted hover:text-ink'
              }
            `}
          >
            <div className="flex items-center gap-2">
              <Icon className="size-4" />
              <span>{tab.label}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
