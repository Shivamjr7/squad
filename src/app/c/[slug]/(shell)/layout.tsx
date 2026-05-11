import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import {
  getCircleBySlug,
  getCircleMemberActivity,
  getCircleMembers,
  getUserCircles,
} from "@/lib/circles";
import { AppShell } from "@/components/layout/AppShell";
import type { SidebarMember } from "@/components/layout/Sidebar";
import { getUnreadCount } from "@/lib/actions/notifications";

export default async function CircleShellLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) notFound();

  const circle = await getCircleBySlug(slug);
  if (!circle) notFound();

  // Critical path: members + userCircles (Sidebar needs identities + the
  // circle switcher needs the list). These two block layout render.
  const [memberRows, userCircles] = await Promise.all([
    getCircleMembers(circle.id),
    getUserCircles(userId),
  ]);

  // Non-critical: bell badge count + recent-activity stamps. Pass as
  // promises so they stream into the Sidebar via React's `use()` +
  // Suspense, not blocking layout render. .catch() on unread keeps
  // transient DB hiccups from blowing up the whole layout.
  const unreadInboxPromise = getUnreadCount().catch(() => 0);
  const activityPromise = getCircleMemberActivity(circle.id);

  const sidebarMembers: SidebarMember[] = memberRows
    .map((m) =>
      m.user
        ? {
            userId: m.user.id,
            displayName: m.user.displayName,
            avatarUrl: m.user.avatarUrl,
          }
        : null,
    )
    .filter((m): m is SidebarMember => m !== null);

  return (
    <AppShell
      currentSlug={slug}
      circles={userCircles}
      members={sidebarMembers}
      nowMs={Date.now()}
      unreadInboxPromise={unreadInboxPromise}
      activityPromise={activityPromise}
    >
      {children}
    </AppShell>
  );
}
