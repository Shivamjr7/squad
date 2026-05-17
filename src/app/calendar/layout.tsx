import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getUserCircles } from "@/lib/circles";
import { getUnreadCount } from "@/lib/actions/notifications";
import { AppShell } from "@/components/layout/AppShell";
import type {
  SidebarCircle,
  SidebarMember,
} from "@/components/layout/Sidebar";

// /calendar is the only cross-circle authed surface — it doesn't live inside
// the `/c/[slug]/(shell)` tree. We still mount AppShell so the Sidebar +
// bottom tab bar are consistent across routes; the `currentSlug` is the
// user's most-recent circle so the per-circle nav items (Home, My plans,
// Squad, Inbox, You) still link somewhere useful.

export default async function CalendarLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const userCircles = await getUserCircles(userId);
  // Per CONVERGENCE_PLAN.md §3: the calendar tab is hidden when the user is
  // in only one circle. We don't 404 — they may have followed a stale link —
  // but we send them back to that one circle's home.
  if (userCircles.length === 0) redirect("/onboarding");
  if (userCircles.length < 2) {
    redirect(`/c/${userCircles[0]!.slug}`);
  }

  const currentSlug = userCircles[0]!.slug;

  const sidebarCircles: SidebarCircle[] = userCircles.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    role: c.role,
    memberCount: c.memberCount,
  }));

  // No "Around now" strip on /calendar — it's per-circle context. Pass an
  // empty members list + an already-resolved empty activity map so the
  // Sidebar's Suspense boundary collapses immediately.
  const members: SidebarMember[] = [];
  const activityPromise = Promise.resolve(new Map<string, Date>());
  const unreadInboxPromise = getUnreadCount();

  return (
    <AppShell
      currentSlug={currentSlug}
      circles={sidebarCircles}
      members={members}
      nowMs={Date.now()}
      unreadInboxPromise={unreadInboxPromise}
      activityPromise={activityPromise}
    >
      {children}
    </AppShell>
  );
}
