import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";
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
import type { FormMember } from "@/components/plan/new-plan-form";
import { getUnreadCount } from "@/lib/actions/notifications";
import { WelcomeRedirector } from "@/components/pwa/welcome-redirector";
import { RememberCurrentCircle } from "@/components/circle/remember-current-circle";

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
  // pushRows is a tiny single-column check that gates the /welcome redirect.
  const [memberRows, userCircles, pushRows] = await Promise.all([
    getCircleMembers(circle.id) as Promise<CircleMemberRow[]>,
    getUserCircles(userId),
    db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .limit(1),
  ]);
  const hasAnyPushSubscription = pushRows.length > 0;

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

  // FormMember rows for the AppShell's NewPlanTrigger (the "+" chip in the
  // mobile top bar / desktop sidebar header). Same shape NewPlanForm reads —
  // we already loaded memberRows above so this is a free reshape.
  const formMembers: FormMember[] = memberRows
    .filter((m) => m.user)
    .map((m) => ({
      userId: m.user!.id,
      displayName: m.user!.displayName,
      avatarUrl: m.user!.avatarUrl,
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
      currentCircleId={circle.id}
      currentUserId={userId}
      formMembers={formMembers}
      circles={sidebarCircles}
      members={sidebarMembers}
      nowMs={Date.now()}
      unreadInboxPromise={unreadInboxPromise}
      activityPromise={activityPromise}
    >
      <RememberCurrentCircle slug={slug} />
      <WelcomeRedirector hasAnyPushSubscription={hasAnyPushSubscription} />
      {children}
    </AppShell>
  );
}
