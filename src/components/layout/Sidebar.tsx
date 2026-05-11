"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Calendar, ClipboardList, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const RECENT_WINDOW_MS = 30 * 60_000;

const DOT_PALETTE = [
  "bg-coral",
  "bg-in",
  "bg-maybe",
  "bg-blue-500",
  "bg-purple-500",
  "bg-emerald-500",
];

function dotForCircle(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return DOT_PALETTE[hash % DOT_PALETTE.length]!;
}

const AVATAR_PALETTE = [
  "bg-coral/20 text-coral",
  "bg-in/15 text-in",
  "bg-maybe/25 text-amber-700",
  "bg-blue-500/15 text-blue-700",
  "bg-purple-500/15 text-purple-700",
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
  lastActiveAt: Date | null;
};

export type SidebarCircle = {
  id: string;
  slug: string;
  name: string;
  role: "admin" | "member";
  memberCount: number;
};

const NAV: {
  label: string;
  icon: typeof Calendar;
  href: (slug: string) => string;
  key: "home" | "plans" | "squad" | "inbox" | "you";
}[] = [
  { key: "home", label: "Home", icon: Calendar, href: (slug) => `/c/${slug}` },
  { key: "plans", label: "My plans", icon: ClipboardList, href: (slug) => `/c/${slug}/plans` },
  { key: "squad", label: "Squad", icon: Users, href: (slug) => `/c/${slug}/squad` },
  { key: "inbox", label: "Inbox", icon: Bell, href: (slug) => `/c/${slug}/notifications` },
  { key: "you", label: "You", icon: User, href: (slug) => `/c/${slug}/you` },
];

export function Sidebar({
  currentSlug,
  circles,
  members,
  // ISO ms snapshot — server passes Date.now() so the client can compute
  // "active in last 30 min" without a hydration mismatch.
  nowMs,
  unreadInbox,
}: {
  currentSlug: string;
  circles: SidebarCircle[];
  members: SidebarMember[];
  nowMs: number;
  unreadInbox: number;
}) {
  const recentlyActive = members.filter(
    (m) =>
      m.lastActiveAt !== null &&
      nowMs - m.lastActiveAt.getTime() <= RECENT_WINDOW_MS,
  );

  return (
    <>
      {/* Desktop sidebar — sticky, full viewport height, transparent. */}
      <aside className="sticky top-0 hidden h-screen w-[160px] shrink-0 flex-col gap-6 px-3 py-6 md:flex">
        <Nav slug={currentSlug} variant="desktop" unreadInbox={unreadInbox} />

        <FavouritesSection circles={circles} />

        {recentlyActive.length > 0 ? (
          <AroundNow members={recentlyActive} />
        ) : null}
      </aside>

      {/* Mobile bottom tab bar — icon-only, the single source of truth on
          mobile. Solid bg + safe-area inset so it sits above the iOS home
          indicator and reads cleanly on every viewport. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-ink/10 bg-paper-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <Nav slug={currentSlug} variant="mobile" unreadInbox={unreadInbox} />
      </nav>
    </>
  );
}

function Nav({
  slug,
  variant,
  unreadInbox,
}: {
  slug: string;
  variant: "desktop" | "mobile";
  unreadInbox: number;
}) {
  const pathname = usePathname() ?? "";
  const badgeText = unreadInbox > 99 ? "99+" : String(unreadInbox);
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
              <Link
                href={href}
                aria-label={
                  showBadge
                    ? `${item.label}, ${unreadInbox} unread`
                    : item.label
                }
                aria-current={active ? "page" : undefined}
                prefetch={false}
                className={cn(
                  "relative flex items-center justify-center py-3 transition-colors",
                  active ? "text-ink" : "text-ink-muted",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {showBadge ? (
                  <span
                    aria-hidden
                    className="absolute top-1.5 right-[calc(50%-14px)] flex h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1 text-[10px] font-semibold leading-none text-white"
                  >
                    {badgeText}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        }
        return (
          <li key={item.label}>
            <Link
              href={href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-2.5 rounded-md py-1.5 pl-2.5 pr-2 text-sm transition-colors",
                active
                  ? "border-l-2 border-coral pl-[calc(0.625rem-2px)] font-semibold text-ink"
                  : "border-l-2 border-transparent text-ink-muted hover:text-ink",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{item.label}</span>
              {showBadge ? (
                <span
                  className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1 text-[10px] font-semibold leading-none text-white"
                  aria-hidden
                >
                  {badgeText}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function FavouritesSection({ circles }: { circles: SidebarCircle[] }) {
  // TODO: filter to pinned circles only once pin feature is added
  if (circles.length === 0) return null;
  return (
    <section aria-labelledby="sidebar-favourites">
      <h2
        id="sidebar-favourites"
        className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted"
      >
        Favourites
      </h2>
      <ul className="mt-2 flex flex-col gap-0.5">
        {circles.map((c) => (
          <li key={c.id}>
            <Link
              href={`/c/${c.slug}`}
              prefetch={false}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", dotForCircle(c.id))}
              />
              <span className="truncate font-medium text-ink">{c.name}</span>
              <span className="ml-auto shrink-0 truncate text-[11px] text-ink-muted">
                {c.role === "admin"
                  ? "admin"
                  : `${c.memberCount} ${c.memberCount === 1 ? "person" : "people"}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AroundNow({ members }: { members: SidebarMember[] }) {
  const stack = members.slice(0, 4);
  return (
    <section aria-labelledby="sidebar-around-now" className="mt-auto">
      <h2
        id="sidebar-around-now"
        className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted"
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
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        className="size-6 rounded-full object-cover ring-2 ring-paper"
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
