import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ArrowLeft, Users } from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, comments, memberships, plans, votes } from "@/db/schema";
import { canModifyPlan } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { formatPlanTime } from "@/lib/format-plan-time";
import { PlanMeta, planTypeLabel } from "@/components/plan/plan-meta";
import { PlanStatusActions } from "@/components/plan/plan-status-actions";
import { StatusPill } from "@/components/plan/status-pill";
import { PlanVotes } from "@/components/votes/plan-votes";
import { PlanComments } from "@/components/comments/plan-comments";
import { CircleSwitcher } from "@/components/circle/circle-switcher";
import { getUserCircles } from "@/lib/circles";
import {
  CircleVotesProvider,
  type Member,
  type VotersByPlan,
} from "@/lib/realtime/use-circle-votes";
import type { PlanComment } from "@/lib/realtime/use-plan-comments";

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ slug: string; planId: string }>;
}) {
  const { slug, planId } = await params;
  const { userId } = await auth();
  if (!userId) notFound();

  const circle = await db.query.circles.findFirst({
    columns: { id: true, name: true, slug: true },
    where: eq(circles.slug, slug),
  });
  if (!circle) notFound();

  const [memberRows, userCircles] = await Promise.all([
    db.query.memberships.findMany({
      where: eq(memberships.circleId, circle.id),
      with: {
        user: {
          columns: { id: true, displayName: true, avatarUrl: true },
        },
      },
    }),
    getUserCircles(userId),
  ]);

  const me = memberRows.find((m) => m.userId === userId);
  if (!me) notFound();

  const plan = await db.query.plans.findFirst({
    where: eq(plans.id, planId),
    with: {
      creator: { columns: { id: true, displayName: true, avatarUrl: true } },
    },
  });
  // Don't leak plan IDs across circles.
  if (!plan || plan.circleId !== circle.id) notFound();

  const canMutateStatus = canModifyPlan(
    { createdBy: plan.createdBy },
    userId,
    { role: me.role },
  );

  const members: Record<string, Member> = {};
  for (const m of memberRows) {
    if (!m.user) continue;
    members[m.user.id] = {
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
    };
  }

  const initialVoters: VotersByPlan = {};
  const voteRows = await db.query.votes.findMany({
    where: eq(votes.planId, planId),
    with: {
      user: {
        columns: { id: true, displayName: true, avatarUrl: true },
      },
    },
  });
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

  const currentUser = {
    id: userId,
    displayName: me.user?.displayName ?? "You",
    avatarUrl: me.user?.avatarUrl ?? null,
  };

  const commentRows = await db.query.comments.findMany({
    where: eq(comments.planId, planId),
    orderBy: asc(comments.createdAt),
    with: {
      user: { columns: { id: true, displayName: true, avatarUrl: true } },
    },
  });
  const initialComments: PlanComment[] = commentRows.map((c) => ({
    id: c.id,
    authorId: c.userId,
    authorName: c.user?.displayName ?? "Member",
    authorAvatarUrl: c.user?.avatarUrl ?? null,
    body: c.body,
    createdAt: c.createdAt.toISOString(),
  }));

  const showVotes = plan.status === "active";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-4 sm:px-6">
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="-ml-2 shrink-0"
            aria-label="Back to circle"
          >
            <Link href={`/c/${circle.slug}`}>
              <ArrowLeft />
            </Link>
          </Button>
          <CircleSwitcher
            currentSlug={circle.slug}
            circles={userCircles}
            size="sm"
          />
        </div>
        <StatusPill
          status={plan.status}
          startsAt={plan.startsAt}
          now={new Date()}
        />
      </header>

      <section className="flex flex-col gap-3">
        <h1
          className={`text-2xl font-semibold leading-tight ${
            plan.status === "cancelled" ? "line-through opacity-60" : ""
          }`}
        >
          {plan.title}
        </h1>
        <PlanMeta
          type={plan.type}
          startsAt={plan.startsAt}
          isApproximate={plan.isApproximate}
          location={plan.location}
          className="text-base"
        />
        <p className="text-sm text-muted-foreground">
          {planTypeLabel(plan.type)}
          {plan.maxPeople ? (
            <>
              {" · "}
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" /> up to {plan.maxPeople}
              </span>
            </>
          ) : null}
        </p>
        {plan.creator ? (
          <div className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
            {plan.creator.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={plan.creator.avatarUrl}
                alt=""
                className="size-6 rounded-full object-cover"
              />
            ) : (
              <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase">
                {plan.creator.displayName.slice(0, 1)}
              </span>
            )}
            <span>Hosted by {plan.creator.displayName}</span>
          </div>
        ) : null}
      </section>

      {showVotes ? (
        <CircleVotesProvider
          initialVoters={initialVoters}
          members={members}
          knownPlanIds={[plan.id]}
          currentUser={currentUser}
        >
          <section className="flex flex-col gap-3 rounded-lg border p-4">
            <h2 className="text-sm font-medium text-muted-foreground">Votes</h2>
            <PlanVotes planId={plan.id} showFirstVoteHint density="detail" />
          </section>
        </CircleVotesProvider>
      ) : null}

      {canMutateStatus && plan.status !== "done" ? (
        <section className="flex flex-col gap-2 pt-2">
          <PlanStatusActions
            planId={plan.id}
            status={plan.status}
            circleSlug={circle.slug}
            planTitle={plan.title}
            planTimeLabel={formatPlanTime(
              plan.startsAt,
              plan.isApproximate,
              new Date(),
            )}
          />
        </section>
      ) : null}

      <section className="flex flex-1 flex-col gap-3 pb-2">
        <h2 className="text-sm font-medium text-muted-foreground">Discussion</h2>
        <PlanComments
          planId={plan.id}
          members={members}
          initialComments={initialComments}
          currentUser={currentUser}
        />
      </section>
    </main>
  );
}
