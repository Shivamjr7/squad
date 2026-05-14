"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { OptimizedSidebar } from "./optimized-sidebar";
import { SquadLogo } from "@/components/brand/squad-logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { usePreloader } from "@/lib/cache/preload-manager";

interface OptimizedAppShellProps {
  currentSlug: string;
  userId: string;
  members: Array<{
    userId: string;
    displayName: string;
    avatarUrl: string | null;
  }>;
  nowMs: number;
  children: ReactNode;
}

export function OptimizedAppShell({
  currentSlug,
  userId,
  members,
  nowMs,
  children,
}: OptimizedAppShellProps) {
  const pathname = usePathname();
  
  // Enable automatic preloading based on current path
  usePreloader(pathname, userId);

  return (
    <div className="md:flex md:items-start">
      <OptimizedSidebar
        currentSlug={currentSlug}
        members={members}
        nowMs={nowMs}
        userId={userId}
        variant="desktop"
      />
      
      <div className="min-w-0 flex-1 pb-[60px] md:pb-0">
        {/* Mobile top bar */}
        <div className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-6 md:hidden">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink transition-opacity hover:opacity-80">
            <SquadLogo className="size-[18px] text-coral" />
            SQUAD
          </div>
          <ThemeToggle />
        </div>
        
        {children}
      </div>
      
      <OptimizedSidebar
        currentSlug={currentSlug}
        members={members}
        nowMs={nowMs}
        userId={userId}
        variant="mobile"
      />
    </div>
  );
}

// Mobile shell for bottom navigation
export function MobileOptimizedAppShell({
  currentSlug,
  userId,
  members,
  nowMs,
  children,
}: OptimizedAppShellProps) {
  const pathname = usePathname();
  
  usePreloader(pathname, userId);

  return (
    <>
      <div className="min-w-0 flex-1 pb-[60px] md:pb-0">
        {/* Mobile top bar */}
        <div className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-6 md:hidden">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink transition-opacity hover:opacity-80">
            <SquadLogo className="size-[18px] text-coral" />
            SQUAD
          </div>
          <ThemeToggle />
        </div>
        
        {children}
      </div>
      
      <OptimizedSidebar
        currentSlug={currentSlug}
        members={members}
        nowMs={nowMs}
        userId={userId}
        variant="mobile"
      />
    </>
  );
}
