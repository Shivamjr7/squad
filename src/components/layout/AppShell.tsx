import type { ReactNode } from "react";
import {
  Sidebar,
  type SidebarCircle,
  type SidebarMember,
} from "./Sidebar";

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
      <div className="min-w-0 flex-1 pb-[60px] md:pb-0">{children}</div>
    </div>
  );
}
