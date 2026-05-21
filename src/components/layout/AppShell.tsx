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
import { CommandPalette } from "@/components/search/command-palette";
import { SearchButton } from "@/components/search/search-button";
import { CircleSwitcher } from "@/components/circle/circle-switcher";
import { InstallBanner } from "@/components/pwa/install-banner";
import { NewPlanTrigger } from "@/components/plan/new-plan-trigger";
import type { FormMember } from "@/components/plan/new-plan-form";

export function AppShell({
  currentSlug,
  currentCircleId,
  currentUserId,
  formMembers,
  circles,
  members,
  nowMs,
  unreadInboxPromise,
  activityPromise,
  children,
}: {
  currentSlug: string;
  // The "+" plan trigger needs a specific circle to insert into. Cross-
  // circle surfaces like /calendar don't have one in scope, so these are
  // optional — when absent we omit the trigger from the chrome.
  currentCircleId?: string;
  currentUserId?: string;
  formMembers?: FormMember[];
  circles: SidebarCircle[];
  members: SidebarMember[];
  nowMs: number;
  unreadInboxPromise: Promise<number>;
  activityPromise: Promise<Map<string, Date>>;
  children: ReactNode;
}) {
  const hasPlanContext =
    currentCircleId !== undefined &&
    currentUserId !== undefined &&
    formMembers !== undefined;
  return (
    <div className="md:flex md:items-start">
      <Sidebar
        currentSlug={currentSlug}
        currentCircleId={hasPlanContext ? currentCircleId : null}
        currentUserId={hasPlanContext ? currentUserId : null}
        formMembers={hasPlanContext ? formMembers : null}
        circles={circles}
        members={members}
        nowMs={nowMs}
        unreadInboxPromise={unreadInboxPromise}
        activityPromise={activityPromise}
      />
      {/* pb-[88px] keeps the floating mobile tab pill from covering content;
          md+ has the sidebar on the side instead so no bottom inset needed. */}
      <div className="min-w-0 flex-1 pb-[88px] md:pb-0">
        {/* Mobile top bar — single combined row: SQUAD brandmark, circle
            switcher (Kaioken ⌄), notification bell, theme toggle. Desktop
            has Sidebar instead, so the switcher is sidebar-only there
            and this row is hidden. Previously the brandmark and the
            switcher lived in two stacked headers; M31 collapsed them
            into one row for above-the-fold breathing room. */}
        <div className="flex items-center justify-between gap-2 px-4 pt-3 sm:px-6 md:hidden">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link
              href="/"
              aria-label="Squad — home"
              className="shrink-0 text-ink transition-opacity hover:opacity-80"
            >
              <SquadLogo className="size-[20px]" />
            </Link>
            <span aria-hidden className="h-4 w-px bg-ink/15" />
            <CircleSwitcher
              currentSlug={currentSlug}
              circles={circles}
              size="sm"
            />
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <SearchButton />
            <Suspense fallback={<NotificationsBellLink slug={currentSlug} count={0} />}>
              <MobileBell
                slug={currentSlug}
                unreadInboxPromise={unreadInboxPromise}
              />
            </Suspense>
            <ThemeToggle />
            {hasPlanContext ? (
              <NewPlanTrigger
                circleId={currentCircleId}
                slug={currentSlug}
                members={formMembers}
                currentUserId={currentUserId}
                mode="header"
              />
            ) : null}
          </div>
        </div>
        {/* PWA install + chained notification opt-in. Renders nothing until
            the browser hands us a `beforeinstallprompt` (Android Chrome) or
            it detects an iOS Safari tab that isn't already standalone. After
            the user accepts the install dialog, the banner morphs into the
            "Turn on notifications" step — which is the only spot in the
            app where we ask. Previously the component existed but was
            never mounted, so the prompt never appeared on mobile. */}
        <InstallBanner />
        {children}
      </div>
      {/* Globally-mounted Cmd-K palette. Owns its own keydown listener;
          the visible component only paints when open. */}
      <CommandPalette />
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
