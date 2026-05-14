"use client";

import { Suspense, useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Bell, Calendar, ClipboardList, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { circleDotClass } from "@/lib/circle-color";
import { SquadLogo } from "@/components/brand/squad-logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { CircleLink } from "./optimized-link";
import { useUserCircles, useNotifications } from "@/hooks/use-optimized-data";

const RECENT_WINDOW_MS = 30 * 60_000;

const AVATAR_PALETTE = [
  "bg-coral/20 text-coral",
  "bg-in/15 text-in",
  "bg-maybe/25 text-maybe",
  "bg-blue-500/15 text-blue-300",
  "bg-purple-500/15 text-purple-300",
];

function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]!;
}

export type SidebarMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

export type SidebarCircle = {
  id: string;
  slug: string;
  name: string;
  role: "admin" | "member";
  memberCount: number;
};

const NAV = [
  { key: "home", label: "Home", icon: Calendar, href: (slug: string) => `/c/${slug}` },
  { key: "plans", label: "My plans", icon: ClipboardList, href: (slug: string) => `/c/${slug}/plans` },
  { key: "squad", label: "Squad", icon: Users, href: (slug: string) => `/c/${slug}/squad` },
  { key: "inbox", label: "Inbox", icon: Bell, href: (slug: string) => `/c/${slug}/notifications` },
  { key: "you", label: "You", icon: User, href: (slug: string) => `/c/${slug}/you` },
];

interface OptimizedSidebarProps {
  currentSlug: string;
  members: SidebarMember[];
  nowMs: number;
  userId: string;
  variant: "desktop" | "mobile";
}

export function OptimizedSidebar({
  currentSlug,
  members,
  nowMs,
  userId,
  variant,
}: OptimizedSidebarProps) {
  // Use optimized data hooks with caching
  const { data: userCircles } = useUserCircles(userId);
  const { data: notifications } = useNotifications(userId);

  if (variant === "desktop") {
    return (
      <aside className="sticky top-0 hidden h-screen w-[176px] shrink-0 flex-col gap-6 px-3 py-6 md:flex">
        <div className="flex items-center justify-between gap-2 pl-2 pr-1">
          <CircleLink
            href="/"
            slug=""
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink transition-opacity hover:opacity-80"
          >
            <SquadLogo className="size-[18px] text-coral" />
            SQUAD
          </CircleLink>
          <ThemeToggle className="-mr-1 size-7" />
        </div>

        <Suspense fallback={<div>Loading navigation...</div>}>
          <NavWithBadge
            slug={currentSlug}
            variant="desktop"
            unreadInbox={notifications?.unreadCount || 0}
          />
        </Suspense>

        <FavouritesSection circles={userCircles || []} />

        <AroundNowAsync
          members={members}
          nowMs={nowMs}
          circleId={currentSlug}
        />
      </aside>
    );
  }

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-ink/10 bg-paper-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <Suspense fallback={<div>Loading navigation...</div>}>
        <NavWithBadge
          slug={currentSlug}
          variant="mobile"
          unreadInbox={notifications?.unreadCount || 0}
        />
      </Suspense>
    </nav>
  );
}

function NavWithBadge({
  slug,
  variant,
  unreadInbox,
}: {
  slug: string;
  variant: "desktop" | "mobile";
  unreadInbox: number;
}) {
  const pathname = usePathname() ?? "";
  const badgeText = unreadInbox > 9 ? "9+" : String(unreadInbox);
  
  return (
    <ul
      className={cn(
        variant === "desktop"
          ? "flex flex-col gap-1"
          : "flex w-full items-center justify-around",
      )}
    >
      {NAV.map((item) => {
        const href = item.href(slug);
        const active = pathname === href;
        const Icon = item.icon;
        const showBadge = item.key === "inbox" && unreadInbox > 0;
        
        if (variant === "mobile") {
          return (
            <li key={item.label} className="flex-1">
              <CircleLink
                href={href}
                slug={slug}
                className={cn(
                  "relative flex items-center justify-center py-3 transition-colors",
                  active ? "text-ink" : "text-ink-muted",
                )}
                aria-label={
                  showBadge
                    ? `${item.label}, ${unreadInbox} unread`
                    : item.label
                }
                aria-current={active ? "page" : undefined}
              >
                <Icon className="size-5" aria-hidden />
                {showBadge ? (
                  <span
                    aria-hidden
                    className="absolute top-1.5 right-[calc(50%-14px)] flex h-4 min-w-4 animate-badge-pulse items-center justify-center rounded-full bg-coral px-1 text-[10px] font-semibold leading-none text-white"
                  >
                    {badgeText}
                  </span>
                ) : null}
              </CircleLink>
            </li>
          );
        }
        
        return (
          <li key={item.label}>
            <CircleLink
              href={href}
              slug={slug}
              className={cn(
                "group flex items-center gap-2.5 rounded-md py-1.5 pl-2.5 pr-2 text-sm transition-colors",
                active
                  ? "border-l-2 border-coral pl-[calc(0.625rem-2px)] font-semibold text-ink"
                  : "border-l-2 border-transparent text-ink-muted hover:text-ink",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{item.label}</span>
              {showBadge ? (
                <span
                  className="ml-auto inline-flex h-4 min-w-4 animate-badge-pulse items-center justify-center rounded-full bg-coral px-1 text-[10px] font-semibold leading-none text-white"
                  aria-hidden
                >
                  {badgeText}
                </span>
              ) : null}
            </CircleLink>
          </li>
        );
      })}
    </ul>
  );
}

function FavouritesSection({ circles }: { circles: SidebarCircle[] }) {
  if (circles.length === 0) return null;
  
  return (
    <section aria-labelledby="sidebar-favourites">
      <h2
        id="sidebar-favourites"
        className="px-2 eyebrow text-ink-muted"
      >
        Favourites
      </h2>
      <ul className="mt-2 flex flex-col gap-0.5">
        {circles.map((c) => (
          <li key={c.id}>
            <CircleLink
              href={`/c/${c.slug}`}
              slug={c.slug}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", circleDotClass(c.id))}
              />
              <span className="truncate font-medium text-ink">{c.name}</span>
              <span className="ml-auto shrink-0 truncate text-[11px] text-ink-muted">
                {c.role === "admin"
                  ? "admin"
                  : `${c.memberCount} ${c.memberCount === 1 ? "person" : "people"}`}
              </span>
            </CircleLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AroundNowAsync({
  members,
  nowMs,
  circleId,
}: {
  members: SidebarMember[];
  nowMs: number;
  circleId: string;
}) {
  const [lastActiveByUser, setLastActiveByUser] = useState<Map<string, Date>>(new Map());

  useEffect(() => {
    const loadActivity = async () => {
      try {
        const response = await fetch(`/api/circles/${circleId}/activity`);
        if (!response.ok) throw new Error('Failed to fetch activity');
        const data = await response.json();
        const activityMap = new Map(data.map((item: { userId: string; lastActive: string }) => [
          item.userId,
          new Date(item.lastActive)
        ])) as Map<string, Date>;
        setLastActiveByUser(activityMap);
      } catch (error) {
        console.error('Failed to load activity:', error);
      }
    };

    loadActivity();
  }, [circleId]);

  const recentlyActive = members.filter((m) => {
    const at = lastActiveByUser.get(m.userId);
    return at && nowMs - at.getTime() <= RECENT_WINDOW_MS;
  });
  
  if (recentlyActive.length === 0) return null;
  return <AroundNow members={recentlyActive} />;
}

function AroundNow({ members }: { members: SidebarMember[] }) {
  const stack = members.slice(0, 4);
  return (
    <section aria-labelledby="sidebar-around-now" className="mt-auto">
      <h2
        id="sidebar-around-now"
        className="px-2 eyebrow text-ink-muted"
      >
        Around now
      </h2>
      <div className="mt-2 flex items-center gap-2 px-2">
        <span className="flex -space-x-1.5">
          {stack.map((m) => (
            <Avatar
              key={m.userId}
              userId={m.userId}
              displayName={m.displayName}
              avatarUrl={m.avatarUrl}
            />
          ))}
        </span>
        <span className="text-xs text-ink-muted">{members.length} online</span>
      </div>
    </section>
  );
}

function Avatar({
  userId,
  displayName,
  avatarUrl,
}: {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="size-6 rounded-full object-cover ring-2 ring-paper"
        loading="lazy"
      />
    );
  }
  const initial = displayName.trim()[0]?.toUpperCase() ?? "?";
  return (
    <span
      className={cn(
        "flex size-6 items-center justify-center rounded-full text-[10px] font-medium uppercase ring-2 ring-paper",
        colorForUser(userId),
      )}
    >
      {initial}
    </span>
  );
}
