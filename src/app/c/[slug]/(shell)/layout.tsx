import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import {
  getCircleBySlug,
  getCircleMemberActivity,
  getCircleMembers,
  getUserCircles,
  type CircleMemberRow,
} from "@/lib/circles";
import { AppShell } from "@/components/layout/AppShell";
import type {
  SidebarCircle,
  SidebarMember,
} from "@/components/layout/Sidebar";
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

  // Critical path: members + circles list (Sidebar needs identities). These
  // block the layout shell render. Below-fold data (unread badge, "around
  // now" activity) flows through Promises that the Sidebar `use()`s inside
  // Suspense boundaries — they stream in without blocking first paint.
  const [memberRows, userCircles] = await Promise.all([
    getCircleMembers(circle.id) as Promise<CircleMemberRow[]>,
    getUserCircles(userId),
  ]);

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

  const sidebarCircles: SidebarCircle[] = userCircles.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    role: c.role,
    memberCount: c.memberCount,
  }));

  // Streamed — not awaited here. Sidebar resolves these inside Suspense.
  const unreadInboxPromise = getUnreadCount();
  const activityPromise = getCircleMemberActivity(circle.id).then(
    (record) =>
      new Map(
        Object.entries(record).map(([uid, iso]) => [uid, new Date(iso)]),
      ),
  );

  return (
    <AppShell
      currentSlug={slug}
      circles={sidebarCircles}
      members={sidebarMembers}
      nowMs={Date.now()}
      unreadInboxPromise={unreadInboxPromise}
      activityPromise={activityPromise}
    >
      {children}
    </AppShell>
  );
}
