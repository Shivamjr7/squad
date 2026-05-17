import { Suspense, use, type ReactNode } from "react";
import Link from "next/link";
import {
  Sidebar,
  type SidebarCircle,
  type SidebarMember,
} from "./Sidebar";
import { SquadLogo } from "@/components/brand/squad-logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { NotificationsBellLink } from "@/components/notifications/notifications-bell-link";

export function AppShell({
  currentSlug,
  circles,
  members,
  nowMs,
  unreadInboxPromise,
  activityPromise,
  children,
}: {
  currentSlug: string;
  circles: SidebarCircle[];
  members: SidebarMember[];
  nowMs: number;
  unreadInboxPromise: Promise<number>;
  activityPromise: Promise<Map<string, Date>>;
  children: ReactNode;
}) {
  return (
    <div className="md:flex md:items-start">
      <Sidebar
        currentSlug={currentSlug}
        circles={circles}
        members={members}
        nowMs={nowMs}
        unreadInboxPromise={unreadInboxPromise}
        activityPromise={activityPromise}
      />
      {/* pb-[60px] keeps the mobile bottom tab bar from covering content;
          md+ has the sidebar on the side instead so no bottom inset needed. */}
      <div className="min-w-0 flex-1 pb-[60px] md:pb-0">
        {/* Mobile top bar — Squad brandmark, notification bell, theme
            toggle. Desktop has all three in the sticky Sidebar; on mobile
            the Sidebar is replaced by the bottom tab bar (icons only), so
            this row carries the cross-circle picker entry + bell + theme
            switch. The bell moved here from the bottom tab bar in #4 — its
            badge mirrors the desktop sidebar via the same Suspense
            boundary on unreadInboxPromise. */}
        <div className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-6 md:hidden">
          <Link
            href="/"
            aria-label="Squad — home"
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink transition-opacity hover:opacity-80"
          >
            <SquadLogo className="size-[18px] text-coral" />
            SQUAD
          </Link>
          <div className="flex items-center gap-0.5">
            <Suspense fallback={<NotificationsBellLink slug={currentSlug} count={0} />}>
              <MobileBell
                slug={currentSlug}
                unreadInboxPromise={unreadInboxPromise}
              />
            </Suspense>
            <ThemeToggle />
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function MobileBell({
  slug,
  unreadInboxPromise,
}: {
  slug: string;
  unreadInboxPromise: Promise<number>;
}) {
  const count = use(unreadInboxPromise);
  return <NotificationsBellLink slug={slug} count={count} />;
}
