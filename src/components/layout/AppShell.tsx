import type { ReactNode } from "react";
import Link from "next/link";
import {
  Sidebar,
  type SidebarCircle,
  type SidebarMember,
} from "./Sidebar";
import { SquadLogo } from "@/components/brand/squad-logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";

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
        {/* Mobile top bar — Squad brandmark + theme toggle. Desktop has
            both in the sticky Sidebar, but on mobile the Sidebar is
            replaced by the bottom tab bar (icons only), so this row is
            how mobile users reach the cross-circle "/" picker and the
            theme switcher. */}
        <div className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-6 md:hidden">
          <Link
            href="/"
            aria-label="Squad — home"
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink transition-opacity hover:opacity-80"
          >
            <SquadLogo className="size-[18px] text-coral" />
            SQUAD
          </Link>
          <ThemeToggle />
        </div>
        {children}
      </div>
    </div>
  );
}
