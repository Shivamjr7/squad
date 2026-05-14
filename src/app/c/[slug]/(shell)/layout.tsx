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
import { OptimizedAppShell } from "@/components/optimized/optimized-app-shell";
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

  // Critical path: members (Sidebar needs identities). This blocks layout render.
  const memberRows = await getCircleMembers(circle.id) as CircleMemberRow[];

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
    <OptimizedAppShell
      currentSlug={slug}
      userId={userId}
      members={sidebarMembers}
      nowMs={Date.now()}
    >
      {children}
    </OptimizedAppShell>
  );
}
