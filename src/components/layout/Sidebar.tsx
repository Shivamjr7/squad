"use client";

import { Suspense, use } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, CalendarDays, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { circleDotClass } from "@/lib/circle-color";
import { SquadLogo } from "@/components/brand/squad-logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { NotificationsBellLink } from "@/components/notifications/notifications-bell-link";

const RECENT_WINDOW_MS = 30 * 60_000;

// Bright text variants — readable on the /15-/25 chip backgrounds against
// the midnight bg. Tailwind palette colors (amber-300 etc.) are kept for
// the non-semantic slots; the in/coral slots use our brand tokens.
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

// Four-tab bar. The previous six-item layout shipped Plans + Inbox as their
// own tabs; those moved out of the bar to surface elsewhere:
//   - Plans  → segmented "All plans / My plans" toggle on /c/[slug] and
//              /c/[slug]/plans (the existing routes stay alive as the two
//              halves of that toggle).
//   - Inbox  → top-right bell (NotificationsBellLink) in the desktop sidebar
//              header + the mobile top bar in AppShell.
// Calendar is now always shown — the previous 2+ circles gate was removed.
const NAV: {
  label: string;
  icon: typeof Calendar;
  href: (slug: string) => string;
  key: "home" | "calendar" | "squad" | "you";
}[] = [
  { key: "home", label: "Home", icon: Calendar, href: (slug) => `/c/${slug}` },
  // Cross-circle — `slug` is unused but the signature stays uniform.
  { key: "calendar", label: "Calendar", icon: CalendarDays, href: () => `/calendar` },
  { key: "squad", label: "Squad", icon: Users, href: (slug) => `/c/${slug}/squad` },
  { key: "you", label: "You", icon: User, href: (slug) => `/c/${slug}/you` },
];

export function Sidebar({
  currentSlug,
  circles,
  members,
  // ISO ms snapshot — server passes Date.now() so the client can compute
  // "active in last 30 min" without a hydration mismatch.
  nowMs,
  unreadInboxPromise,
  activityPromise,
}: {
  currentSlug: string;
  circles: SidebarCircle[];
  members: SidebarMember[];
  nowMs: number;
  // Promises (not awaited values) so the layout doesn't block on them —
  // React's `use()` hook reads inside a Suspense boundary, streaming the
  // bell badge + Around-now stack in after first paint.
  unreadInboxPromise: Promise<number>;
  activityPromise: Promise<Map<string, Date>>;
}) {
  return (
    <>
      {/* Desktop sidebar — sticky, full viewport height, transparent. */}
      <aside className="sticky top-0 hidden h-screen w-[176px] shrink-0 flex-col gap-6 px-3 py-6 md:flex">
        {/* Brandmark — anchors the authed app to the Squad identity.
            Coral dots + uppercase wordmark, same pairing as landing nav.
            Links to "/" (the Circles/Plans tabs home, the user's
            cross-circle picker), NOT the current circle. Theme toggle +
            notification bell pinned at the right; -mr-1 cancels px-3 of the
            aside so the trailing controls sit flush. */}
        <div className="flex items-center justify-between gap-2 pl-2 pr-1">
          <Link
            href="/"
            aria-label="Squad — home"
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink transition-opacity hover:opacity-80"
          >
            <SquadLogo className="size-[18px] text-ink dark:text-paper" />
            SQUAD
          </Link>
          <div className="-mr-1 flex items-center gap-0.5">
            <Suspense fallback={<NotificationsBellLink slug={currentSlug} count={0} className="size-7" />}>
              <BellWithBadge
                slug={currentSlug}
                unreadInboxPromise={unreadInboxPromise}
              />
            </Suspense>
            <ThemeToggle className="size-7" />
          </div>
        </div>

        <Nav slug={currentSlug} variant="desktop" />

        <FavouritesSection circles={circles} />

        <Suspense fallback={null}>
          <AroundNowAsync
            members={members}
            nowMs={nowMs}
            activityPromise={activityPromise}
          />
        </Suspense>
      </aside>

      {/* Mobile bottom tab bar — icon-only, the single source of truth on
          mobile. Solid bg + safe-area inset so it sits above the iOS home
          indicator and reads cleanly on every viewport. The notification
          bell lives in the mobile top bar (see AppShell), not down here. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-ink/10 bg-paper-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <Nav slug={currentSlug} variant="mobile" />
      </nav>
    </>
  );
}

// Small wrapper so the Suspense boundary above can `use()` the
// unreadInboxPromise without converting NotificationsBellLink itself into a
// client+Suspense component.
function BellWithBadge({
  slug,
  unreadInboxPromise,
}: {
  slug: string;
  unreadInboxPromise: Promise<number>;
}) {
  const count = use(unreadInboxPromise);
  return <NotificationsBellLink slug={slug} count={count} className="size-7" />;
}

function AroundNowAsync({
  members,
  nowMs,
  activityPromise,
}: {
  members: SidebarMember[];
  nowMs: number;
  activityPromise: Promise<Map<string, Date>>;
}) {
  const lastActiveByUser = use(activityPromise);
  const recentlyActive = members.filter((m) => {
    const at = lastActiveByUser.get(m.userId);
    return at !== undefined && nowMs - at.getTime() <= RECENT_WINDOW_MS;
  });
  if (recentlyActive.length === 0) return null;
  return <AroundNow members={recentlyActive} />;
}

function Nav({
  slug,
  variant,
}: {
  slug: string;
  variant: "desktop" | "mobile";
}) {
  const pathname = usePathname() ?? "";
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
        if (variant === "mobile") {
          return (
            <li key={item.label} className="flex-1">
              <Link
                href={href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center justify-center py-3 transition-colors",
                  active ? "text-ink" : "text-ink-muted",
                )}
              >
                <Icon className="size-5" aria-hidden />
              </Link>
            </li>
          );
        }
        return (
          <li key={item.label}>
            <Link
              href={href}
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
        className="px-2 eyebrow text-ink-muted"
      >
        Favourites
      </h2>
      <ul className="mt-2 flex flex-col gap-0.5">
        {circles.map((c) => (
          <li key={c.id}>
            <Link
              href={`/c/${c.slug}`}
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
