import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, comments, memberships, plans, votes } from "@/db/schema";
import { CircleSwitcher } from "@/components/circle/circle-switcher";
import { MyPlansPage, type MyPlansPagePlan } from "@/components/plan/my-plans-page";
import { getUserCircles } from "@/lib/circles";
import { requireDisplayNameSet } from "@/lib/auth";
import {
  CircleVotesProvider,
  type Member,
  type VotersByPlan,
} from "@/lib/realtime/use-circle-votes";

export default async function MyPlansRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) notFound();
  await requireDisplayNameSet(userId);

  const circle = await db.query.circles.findFirst({
    columns: { id: true, name: true, slug: true },
    where: eq(circles.slug, slug),
  });
  if (!circle) notFound();

  const [membership, userCircles, memberRows] = await Promise.all([
    db.query.memberships.findFirst({
      columns: { role: true },
      where: and(
        eq(memberships.userId, userId),
        eq(memberships.circleId, circle.id),
      ),
    }),
    getUserCircles(userId),
    db.query.memberships.findMany({
      where: eq(memberships.circleId, circle.id),
      orderBy: asc(memberships.joinedAt),
      with: {
        user: { columns: { id: true, displayName: true, avatarUrl: true } },
      },
    }),
  ]);

  if (!membership) notFound();

  const me = memberRows.find((m) => m.userId === userId);
  if (!me) notFound();

  const members: Record<string, Member> = {};
  for (const m of memberRows) {
    if (!m.user) continue;
    members[m.user.id] = {
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
    };
  }

  const recipientVisibilityClause = membership.role === "admin"
    ? undefined
    : or(
        sql`NOT EXISTS (SELECT 1 FROM plan_recipients pr WHERE pr.plan_id = ${plans.id})`,
        sql`EXISTS (SELECT 1 FROM plan_recipients pr WHERE pr.plan_id = ${plans.id} AND pr.user_id = ${userId})`,
      );

  const planRows = await db.query.plans.findMany({
    where: and(
      eq(plans.circleId, circle.id),
      recipientVisibilityClause,
    ),
    orderBy: [desc(plans.startsAt)],
    with: {
      creator: { columns: { displayName: true, avatarUrl: true } },
    },
  });

  const planIds = planRows.map((p) => p.id);
  const [commentRows, voteRows] = planIds.length
    ? await Promise.all([
        db
          .select({ planId: comments.planId, n: count() })
          .from(comments)
          .where(inArray(comments.planId, planIds))
          .groupBy(comments.planId),
        db.query.votes.findMany({
          where: inArray(votes.planId, planIds),
          with: {
            user: {
              columns: { id: true, displayName: true, avatarUrl: true },
            },
          },
        }),
      ])
    : [[], []];

  const counts = new Map<string, number>();
  for (const row of commentRows) {
    counts.set(row.planId, Number(row.n));
  }

  const initialVoters: VotersByPlan = {};
  for (const v of voteRows) {
    if (!v.user) continue;
    const list = initialVoters[v.planId] ?? [];
    list.push({
      userId: v.user.id,
      displayName: v.user.displayName,
      avatarUrl: v.user.avatarUrl,
      status: v.status,
      votedAt: v.votedAt.toISOString(),
    });
    initialVoters[v.planId] = list;
  }

  const currentUser = {
    id: userId,
    displayName: me.user?.displayName ?? "You",
    avatarUrl: me.user?.avatarUrl ?? null,
  };

  const planData: MyPlansPagePlan[] = planRows.map((plan) => ({
    id: plan.id,
    title: plan.title,
    type: plan.type,
    startsAt: plan.startsAt.toISOString(),
    timeZone: plan.timeZone,
    isApproximate: plan.isApproximate,
    location: plan.location,
    status: plan.status,
    creator: plan.creator
      ? {
          displayName: plan.creator.displayName,
          avatarUrl: plan.creator.avatarUrl,
        }
      : null,
    commentCount: counts.get(plan.id) ?? 0,
  }));

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl pb-32">
      <header className="flex items-center justify-between gap-2 px-4 pt-3 sm:px-6">
        <CircleSwitcher currentSlug={circle.slug} circles={userCircles} size="sm" />
        <span className="shrink-0 text-sm font-medium text-ink-muted">
          My plans
        </span>
      </header>

      <div className="px-4 pt-6 sm:px-6">
        <CircleVotesProvider
          initialVoters={initialVoters}
          members={members}
          knownPlanIds={planIds}
          currentUser={currentUser}
        >
          <MyPlansPage plans={planData} slug={circle.slug} />
        </CircleVotesProvider>
      </div>

    </main>
  );
}
