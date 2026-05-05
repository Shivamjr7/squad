import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ArrowLeft } from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { circles, comments, memberships, plans, votes } from "@/db/schema";
import { canModifyPlan, requireDisplayNameSet } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { formatPlanTime } from "@/lib/format-plan-time";
import { PlanVotes } from "@/components/votes/plan-votes";
import { VoteProgressBar } from "@/components/votes/vote-progress-bar";
import { VoterListDetail } from "@/components/votes/voter-list-detail";
import { PlanComments } from "@/components/comments/plan-comments";
import { PlanOverflowMenu } from "@/components/plan/plan-overflow-menu";
import { CircleSwitcher } from "@/components/circle/circle-switcher";
import { BottomTabs } from "@/components/circle/bottom-tabs";
import { getUserCircles } from "@/lib/circles";
import {
  CircleVotesProvider,
  type Member,
  type VotersByPlan,
} from "@/lib/realtime/use-circle-votes";
import type { PlanComment } from "@/lib/realtime/use-plan-comments";

const SHORT_TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const SHORT_DAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function relativeCreatedAt(createdAt: Date, now: Date): string {
  const diffMs = now.getTime() - createdAt.getTime();
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24 && isSameLocalDay(createdAt, now)) {
    return SHORT_TIME.format(createdAt).toLowerCase().replace(" ", "");
  }
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(createdAt);
}

function dayDescriptor(startsAt: Date, now: Date): string {
  if (isSameLocalDay(startsAt, now)) {
    const h = startsAt.getHours();
    if (h >= 18) return "tonight";
    if (h >= 12) return "this afternoon";
    return "this morning";
  }
  const dayMs = 86_400_000;
  const diffDays = Math.round(
    (startsAt.getTime() - now.getTime()) / dayMs,
  );
  if (diffDays === 1) return "tomorrow";
  if (diffDays > 1 && diffDays < 7) return SHORT_DAY.format(startsAt);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(startsAt);
}

function statusLine(
  status: "active" | "confirmed" | "done" | "cancelled",
  startsAt: Date,
  decideBy: Date | null,
  now: Date,
): { label: string; tone: "deciding" | "confirmed" | "muted" } {
  if (status === "cancelled") {
    return { label: "Cancelled", tone: "muted" };
  }
  if (status === "done") {
    return { label: "Done", tone: "muted" };
  }
  if (status === "confirmed") {
    return {
      label: `Confirmed · ${SHORT_DAY.format(startsAt).toUpperCase()} ${SHORT_TIME.format(startsAt)}`,
      tone: "confirmed",
    };
  }
  // active
  if (decideBy && decideBy.getTime() > now.getTime()) {
    return {
      label: `Deciding now · Ends ${SHORT_TIME.format(decideBy)}`,
      tone: "deciding",
    };
  }
  return { label: "Deciding now", tone: "deciding" };
}

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ slug: string; planId: string }>;
}) {
  const { slug, planId } = await params;
  const { userId } = await auth();
  if (!userId) notFound();
  await requireDisplayNameSet(userId);

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
      votedAt: v.votedAt.toISOString(),
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

  const now = new Date();
  const showVotes = plan.status === "active" || plan.status === "confirmed";
  const status = statusLine(plan.status, plan.startsAt, plan.decideBy, now);
  const memberCount = memberRows.length;

  // "8:30" big + "PM tonight" smaller — split for the CURRENT PLAN card.
  const isApprox = plan.isApproximate;
  let bigTime = "";
  let smallTime = "";
  if (isApprox) {
    bigTime = formatPlanTime(plan.startsAt, true, now);
  } else {
    const parts = SHORT_TIME.formatToParts(plan.startsAt);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "";
    const ampm =
      parts.find((p) => p.type === "dayPeriod")?.value?.toUpperCase() ?? "";
    bigTime = `${hour}:${minute}`;
    smallTime = `${ampm} ${dayDescriptor(plan.startsAt, now)}`;
  }

  return (
    <CircleVotesProvider
      initialVoters={initialVoters}
      members={members}
      knownPlanIds={[plan.id]}
      currentUser={currentUser}
    >
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 pt-3 pb-32 sm:px-6">
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
          {canMutateStatus ? (
            <PlanOverflowMenu
              planId={plan.id}
              status={plan.status}
              circleSlug={circle.slug}
              planTitle={plan.title}
              planTimeLabel={formatPlanTime(plan.startsAt, isApprox, now)}
            />
          ) : null}
        </header>

        <section className="flex flex-col gap-3">
          <span
            className={
              "text-[11px] font-semibold uppercase tracking-[0.18em] " +
              (status.tone === "confirmed"
                ? "text-in"
                : status.tone === "deciding"
                  ? "text-coral"
                  : "text-ink-muted")
            }
          >
            {status.label}
          </span>
          <h1
            className={
              "font-serif text-3xl font-semibold leading-tight text-ink sm:text-4xl " +
              (plan.status === "cancelled" ? "line-through opacity-60" : "")
            }
          >
            {plan.title}
          </h1>
          <p className="text-sm text-ink-muted">
            started by {plan.creator?.displayName ?? "Someone"}{" "}
            <span aria-hidden>·</span>{" "}
            {relativeCreatedAt(plan.createdAt, now)}{" "}
            <span aria-hidden>·</span> {memberCount}{" "}
            {memberCount === 1 ? "person" : "people"}
          </p>
        </section>

        <section className="flex flex-col gap-4 rounded-2xl bg-paper-card p-5 shadow-[0_1px_2px_rgba(20,15,10,0.04),0_8px_24px_-12px_rgba(20,15,10,0.10)]">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
            Current plan
          </span>
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-5xl font-semibold leading-none text-ink">
              {bigTime}
            </span>
            {smallTime ? (
              <span className="text-sm text-ink-muted">{smallTime}</span>
            ) : null}
          </div>
          {plan.location ? (
            <p className="text-base text-ink">
              {plan.location}{" "}
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(plan.location)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-coral underline-offset-2 hover:underline"
              >
                map
              </a>
            </p>
          ) : (
            <p className="text-base text-ink-muted">Location TBD</p>
          )}
          <VoteProgressBar planId={plan.id} />
        </section>

        {showVotes ? (
          <section className="flex flex-col gap-4">
            <PlanVotes
              planId={plan.id}
              showFirstVoteHint
              density="detail"
              buttonSize="lg"
              showTally={false}
            />
            <VoterListDetail
              planId={plan.id}
              creatorId={plan.creator?.id ?? null}
            />
            {plan.decideBy && plan.decideBy.getTime() > now.getTime() ? (
              <p className="pt-1 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
                Plan locks at {SHORT_TIME.format(plan.decideBy)}
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="flex flex-1 flex-col gap-3 border-t border-ink/10 pt-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
            Discussion
          </h2>
          <PlanComments
            planId={plan.id}
            members={members}
            initialComments={initialComments}
            currentUser={currentUser}
          />
        </section>
        <BottomTabs slug={circle.slug} />
      </main>
    </CircleVotesProvider>
  );
}
