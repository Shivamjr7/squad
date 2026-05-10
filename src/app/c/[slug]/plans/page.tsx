import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, comments, memberships, plans } from "@/db/schema";
import { CircleSwitcher } from "@/components/circle/circle-switcher";
import { BottomTabs } from "@/components/circle/bottom-tabs";
import { CircleSideMenu, CircleSideMenuMobile } from "@/components/circle/circle-side-menu";
import { MyPlansPage, type MyPlansPagePlan } from "@/components/plan/my-plans-page";
import { getUserCircles } from "@/lib/circles";
import { requireDisplayNameSet } from "@/lib/auth";

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

  const [membership, userCircles] = await Promise.all([
    db.query.memberships.findFirst({
      columns: { role: true },
      where: and(
        eq(memberships.userId, userId),
        eq(memberships.circleId, circle.id),
      ),
    }),
    getUserCircles(userId),
  ]);

  if (!membership) notFound();

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

  const commentRows = planRows.length
    ? await db
        .select({ planId: comments.planId, n: count() })
        .from(comments)
        .where(inArray(comments.planId, planRows.map((p) => p.id)))
        .groupBy(comments.planId)
    : [];

  const counts = new Map<string, number>();
  for (const row of commentRows) {
    counts.set(row.planId, Number(row.n));
  }

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
        <div className="flex items-center gap-2">
          <CircleSideMenuMobile slug={circle.slug} />
          <CircleSwitcher currentSlug={circle.slug} circles={userCircles} size="sm" />
        </div>
        <span className="shrink-0 text-sm font-medium text-ink-muted">
          My plans
        </span>
      </header>

      <div className="grid gap-6 px-4 pt-6 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <CircleSideMenu slug={circle.slug} />
        </aside>

        <div>
          <MyPlansPage plans={planData} slug={circle.slug} />
        </div>
      </div>

      <BottomTabs slug={circle.slug} />
    </main>
  );
}
