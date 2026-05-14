"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useCallback } from "react";
import { preloadManager } from "@/lib/cache/preload-manager";

interface OptimizedLinkProps {
  href: string;
  children: React.ReactNode;
  prefetch?: boolean;
  preloadData?: Array<{
    key: string;
    loader: () => Promise<unknown>;
    ttl?: number;
  }>;
  className?: string;
  onClick?: () => void;
  slug?: string;
  [key: string]: unknown;
}

export function OptimizedLink({
  href,
  children,
  prefetch = true,
  preloadData = [],
  className,
  onClick,
  ...props
}: OptimizedLinkProps) {
  const router = useRouter();
  const [isPreloading, setIsPreloading] = useState(false);

  const handleMouseEnter = useCallback(() => {
    if (!prefetch || isPreloading) return;

    setIsPreloading(true);

    // Preload the page
    if (typeof window !== 'undefined') {
      router.prefetch(href);
    }

    // Preload associated data
    preloadData.forEach(({ key, loader, ttl }) => {
      preloadManager.add({
        key,
        loader,
        priority: "medium",
        ttl,
      });
    });

    // Reset preloading state after a delay
    setTimeout(() => setIsPreloading(false), 1000);
  }, [href, prefetch, preloadData, isPreloading, router]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    onClick?.();
    
    // For same-origin links, use Next.js router for faster navigation
    if (href.startsWith('/') || href.startsWith('#')) {
      e.preventDefault();
      router.push(href);
    }
  }, [href, onClick, router]);

  return (
    <Link
      href={href}
      className={className}
      onMouseEnter={handleMouseEnter}
      onClick={handleClick}
      {...props}
    >
      {children}
    </Link>
  );
}

// Specialized optimized links for common navigation patterns
export function CircleLink({
  slug,
  children,
  className,
  ...props
}: {
  slug: string;
  children: React.ReactNode;
  className?: string;
  [key: string]: unknown;
}) {
  return (
    <OptimizedLink
      href={`/c/${slug}`}
      preloadData={[
        {
          key: `circle:${slug}:plans`,
          loader: () => fetch(`/api/circles/${slug}/plans`).then(r => r.json()),
          ttl: 2 * 60 * 1000,
        },
        {
          key: `circle:${slug}:members`,
          loader: () => fetch(`/api/circles/${slug}/members`).then(r => r.json()),
          ttl: 10 * 60 * 1000,
        },
      ]}
      className={className}
      {...props}
    >
      {children}
    </OptimizedLink>
  );
}

export function PlanLink({
  slug,
  planId,
  children,
  className,
  ...props
}: {
  slug: string;
  planId: string;
  children: React.ReactNode;
  className?: string;
  [key: string]: unknown;
}) {
  return (
    <OptimizedLink
      href={`/c/${slug}/p/${planId}`}
      preloadData={[
        {
          key: `plan:${planId}:details`,
          loader: () => fetch(`/api/plans/${planId}`).then(r => r.json()),
          ttl: 5 * 60 * 1000,
        },
      ]}
      className={className}
      {...props}
    >
      {children}
    </OptimizedLink>
  );
}
