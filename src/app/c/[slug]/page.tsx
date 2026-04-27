import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { Settings } from "lucide-react";
import { and, asc, count, desc, eq, gte, inArray, lt, ne, or } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, comments, memberships, plans, votes } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { NewPlanTrigger } from "@/components/plan/new-plan-trigger";
import { PlanCard } from "@/components/plan/plan-card";
import { InviteButton } from "@/components/circle/invite-button";
import { PostJoinToast } from "@/components/circle/post-join-toast";
import {
  CircleVotesProvider,
  type Member,
  type VotersByPlan,
} from "@/lib/realtime/use-circle-votes";

export default async function CircleHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) notFound();

  const circle = await db.query.circles.findFirst({
    columns: { id: true, name: true, slug: true },
    where: eq(circles.slug, slug),
  });
  if (!circle) notFound();

  const memberRows = await db.query.memberships.findMany({
    where: eq(memberships.circleId, circle.id),
    with: {
      user: {
        columns: { id: true, displayName: true, avatarUrl: true },
      },
    },
  });

  const me = memberRows.find((m) => m.userId === userId);
  if (!me) notFound();

  const isAdmin = me.role === "admin";

  const members: Record<string, Member> = {};
  for (const m of memberRows) {
    if (!m.user) continue;
    members[m.user.id] = {
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
    };
  }

  const now = new Date();
  const [upcoming, past] = await Promise.all([
    db.query.plans.findMany({
      where: and(
        eq(plans.circleId, circle.id),
        eq(plans.status, "active"),
        gte(plans.startsAt, now),
      ),
      orderBy: asc(plans.startsAt),
      with: {
        creator: { columns: { displayName: true, avatarUrl: true } },
      },
    }),
    db.query.plans.findMany({
      where: and(
        eq(plans.circleId, circle.id),
        or(ne(plans.status, "active"), lt(plans.startsAt, now)),
      ),
      orderBy: desc(plans.startsAt),
      with: {
        creator: { columns: { displayName: true, avatarUrl: true } },
      },
    }),
  ]);

  const planIds = [...upcoming, ...past].map((p) => p.id);
  const initialVoters: VotersByPlan = {};
  const commentCounts = new Map<string, number>();
  if (planIds.length > 0) {
    const [voteRows, countRows] = await Promise.all([
      db.query.votes.findMany({
        where: inArray(votes.planId, planIds),
        with: {
          user: {
            columns: { id: true, displayName: true, avatarUrl: true },
          },
        },
      }),
      db
        .select({ planId: comments.planId, n: count() })
        .from(comments)
        .where(inArray(comments.planId, planIds))
        .groupBy(comments.planId),
    ]);
    for (const v of voteRows) {
      if (!v.user) continue;
      const list = initialVoters[v.planId] ?? [];
      list.push({
        userId: v.user.id,
        displayName: v.user.displayName,
        avatarUrl: v.user.avatarUrl,
        status: v.status,
      });
      initialVoters[v.planId] = list;
    }
    for (const row of countRows) {
      commentCounts.set(row.planId, Number(row.n));
    }
  }

  const currentUser = {
    id: userId,
    displayName: me.user?.displayName ?? "You",
    avatarUrl: me.user?.avatarUrl ?? null,
  };

  const isEmpty = upcoming.length === 0 && past.length === 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col pb-32">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <h1 className="truncate text-xl font-semibold tracking-tight">
          {circle.name}
        </h1>
        <div className="flex items-center gap-1">
          {isAdmin ? (
            <Button asChild variant="ghost" size="icon" aria-label="Settings">
              <Link href={`/c/${circle.slug}/settings`}>
                <Settings />
              </Link>
            </Button>
          ) : null}
          <UserButton />
        </div>
      </header>

      <CircleVotesProvider
        initialVoters={initialVoters}
        members={members}
        knownPlanIds={planIds}
        currentUser={currentUser}
      >
        {isEmpty ? (
          <section className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <p className="text-base font-medium">No plans yet.</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Tap + to propose one.
            </p>
            {isAdmin ? (
              <div className="mt-6">
                <InviteButton circleId={circle.id} />
              </div>
            ) : null}
          </section>
        ) : (
          <div className="flex flex-col gap-8 px-4 py-6 sm:px-6">
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-muted-foreground">
                Upcoming
              </h2>
              {upcoming.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No upcoming plans yet. Tap + to propose one.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {upcoming.map((p) => (
                    <li key={p.id}>
                      <PlanCard
                        plan={{ ...p, commentCount: commentCounts.get(p.id) ?? 0 }}
                        slug={circle.slug}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {past.length > 0 ? (
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-medium text-muted-foreground">
                  Past
                </h2>
                <ul className="flex flex-col gap-3">
                  {past.map((p) => (
                    <li key={p.id}>
                      <PlanCard
                        plan={{ ...p, commentCount: commentCounts.get(p.id) ?? 0 }}
                        slug={circle.slug}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </CircleVotesProvider>

      <NewPlanTrigger circleId={circle.id} slug={circle.slug} />
      <Suspense fallback={null}>
        <PostJoinToast />
      </Suspense>
    </main>
  );
}
