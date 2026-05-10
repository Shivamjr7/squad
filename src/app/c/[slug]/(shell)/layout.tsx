import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, memberships, plans, votes } from "@/db/schema";
import { getUserCircles } from "@/lib/circles";
import { AppShell } from "@/components/layout/AppShell";
import type { SidebarMember } from "@/components/layout/Sidebar";

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

  const circle = await db.query.circles.findFirst({
    columns: { id: true, slug: true },
    where: eq(circles.slug, slug),
  });
  if (!circle) notFound();

  const [memberRows, userCircles] = await Promise.all([
    db.query.memberships.findMany({
      where: eq(memberships.circleId, circle.id),
      orderBy: asc(memberships.joinedAt),
      with: {
        user: { columns: { id: true, displayName: true, avatarUrl: true } },
      },
    }),
    getUserCircles(userId),
  ]);

  const memberIds = memberRows
    .map((m) => m.user?.id)
    .filter((id): id is string => Boolean(id));

  const [voteActivity, planActivity] = memberIds.length
    ? await Promise.all([
        db
          .select({ userId: votes.userId, at: max(votes.votedAt) })
          .from(votes)
          .innerJoin(plans, eq(votes.planId, plans.id))
          .where(
            and(
              eq(plans.circleId, circle.id),
              inArray(votes.userId, memberIds),
            ),
          )
          .groupBy(votes.userId),
        db
          .select({ userId: plans.createdBy, at: max(plans.createdAt) })
          .from(plans)
          .where(
            and(
              eq(plans.circleId, circle.id),
              inArray(plans.createdBy, memberIds),
            ),
          )
          .groupBy(plans.createdBy),
      ])
    : [[], []];

  const lastActiveByUser = new Map<string, Date>();
  for (const r of voteActivity) {
    if (!r.userId || !r.at) continue;
    const prev = lastActiveByUser.get(r.userId);
    if (!prev || r.at > prev) lastActiveByUser.set(r.userId, r.at);
  }
  for (const r of planActivity) {
    if (!r.userId || !r.at) continue;
    const prev = lastActiveByUser.get(r.userId);
    if (!prev || r.at > prev) lastActiveByUser.set(r.userId, r.at);
  }

  const sidebarMembers: SidebarMember[] = memberRows
    .map((m) =>
      m.user
        ? {
            userId: m.user.id,
            displayName: m.user.displayName,
            avatarUrl: m.user.avatarUrl,
            lastActiveAt: lastActiveByUser.get(m.user.id) ?? null,
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
    >
      {children}
    </AppShell>
  );
}
