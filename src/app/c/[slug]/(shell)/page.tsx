import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { Settings } from "lucide-react";
import { and, asc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { plans, votes } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { NewPlanTrigger } from "@/components/plan/new-plan-trigger";
import {
  HomePlanFeed,
  type HomeDeckPlan,
} from "@/components/plan/home-plan-feed";
import type { ThisWeekListPlan } from "@/components/plan/this-week-list";
import { PostJoinToast } from "@/components/circle/post-join-toast";
import { GetStartedChecklist } from "@/components/onboarding/get-started-checklist";
import { FirstRunTour } from "@/components/onboarding/first-run-tour";
import { OrbitalEmptyState } from "@/components/plan/orbital-empty-state";
import { GradientAvatar } from "@/components/ui/gradient-avatar";
import {
  SquadPulseAsync,
  SquadPulseSkeleton,
} from "@/components/circle/squad-pulse-async";
import {
  LockingSoonPanel,
  LockingSoonSkeleton,
} from "@/components/circle/locking-soon-panel";
import { SuggestPanel } from "@/components/circle/suggest-panel";
import type { FormMember } from "@/components/plan/new-plan-form";
import {
  getCircleBySlug,
  getCircleMembers,
  type CircleMemberRow,
} from "@/lib/circles";
import { requireDisplayNameSet } from "@/lib/auth";
import {
  CircleVotesProvider,
  type Member,
  type VotersByPlan,
} from "@/lib/realtime/use-circle-votes";
import { LocalGreeting } from "@/components/home/local-greeting";

const DATE_ROW_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

function formatDateHeader(now: Date): string {
  // "SUN · MAY 10" — short weekday + month/day, dot-separated, uppercased.
  const parts = DATE_ROW_FMT.formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${wd.toUpperCase()} · ${month.toUpperCase()} ${day}`;
}

function firstName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0]!;
}

export default async function CircleHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) notFound();
  await requireDisplayNameSet(userId);

  const circle = await getCircleBySlug(slug);
  if (!circle) notFound();

  // Gates the GetStartedChecklist. The checklist is for genuinely new
  // users — anyone who's already created a plan or voted on one has
  // seen the flow, so the prompt shouldn't re-appear every time a
  // circle goes quiet between plans. Two indexed LIMIT-1 lookups
  // (plans.created_by, votes.user_id are both indexed); folded into
  // the existing Promise.all to share the round-trip.
  const [memberRows, hasUserActivity] = await Promise.all([
    getCircleMembers(circle.id) as Promise<CircleMemberRow[]>,
    (async () => {
      const [createdAny, votedAny] = await Promise.all([
        db.query.plans.findFirst({
          columns: { id: true },
          where: eq(plans.createdBy, userId),
        }),
        db.query.votes.findFirst({
          columns: { planId: true },
          where: eq(votes.userId, userId),
        }),
      ]);
      return Boolean(createdAny) || Boolean(votedAny);
    })(),
  ]);

  const me = memberRows.find((m) => m.userId === userId);
  if (!me) notFound();

  const isAdmin = me.role === "admin";

  const members: Record<string, Member> = {};
  const formMembers: FormMember[] = [];
  for (const m of memberRows) {
    if (!m.user) continue;
    members[m.user.id] = {
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
    };
    formMembers.push({
      userId: m.user.id,
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
    });
  }

  const now = new Date();
  const recentCancelledSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // M23 — visibility filter. A plan shows on home when (a) it has no
  // explicit recipient rows (back-compat: full circle), (b) the current
  // user is in the recipient set, or (c) the user is an admin (admins see
  // all plans in their circle, including restricted ones, per spec).
  // Note: subquery columns are written as bare SQL because Drizzle's
  // ${table.col} interpolation here resolves to the outer query's alias.
  const recipientVisibilityClause = isAdmin
    ? undefined
    : or(
        sql`NOT EXISTS (SELECT 1 FROM plan_recipients pr WHERE pr.plan_id = ${plans.id})`,
        sql`EXISTS (SELECT 1 FROM plan_recipients pr WHERE pr.plan_id = ${plans.id} AND pr.user_id = ${userId})`,
        eq(plans.createdBy, userId),
      );

  const upcomingRaw = await db.query.plans.findMany({
    where: and(
      eq(plans.circleId, circle.id),
      or(
        and(
          inArray(plans.status, ["active", "confirmed"]),
          gte(plans.startsAt, now),
        ),
        and(
          eq(plans.status, "cancelled"),
          gte(plans.cancelledAt, recentCancelledSince),
        ),
      ),
      recipientVisibilityClause,
    ),
    orderBy: [asc(plans.startsAt)],
    with: {
      creator: { columns: { displayName: true, avatarUrl: true } },
      votes: {
        with: {
          user: {
            columns: { id: true, displayName: true, avatarUrl: true },
          },
        },
      },
      venues: {
        columns: { id: true, label: true },
        with: {
          votes: { columns: { venueId: true } },
        },
      },
    },
  });

  // Re-order upcoming so the cards that demand action surface first.
  // Priority key (lower = higher priority):
  //   0 — vote still open + you haven't said
  //   1 — vote still open + you've said
  //   2 — locked + you haven't RSVP'd
  //   3 — locked + you've RSVP'd
  // Within each bucket: earliest startsAt first.
  function attentionRank(p: (typeof upcomingRaw)[number]): number {
    if (p.status === "cancelled") return 4;
    const voted = p.votes.some((v) => v.userId === userId);
    if (p.status === "active") return voted ? 1 : 0;
    return voted ? 3 : 2;
  }
  const upcoming = [...upcomingRaw].sort((a, b) => {
    const diff = attentionRank(a) - attentionRank(b);
    if (diff !== 0) return diff;
    return a.startsAt.getTime() - b.startsAt.getTime();
  });

  const planIds = upcoming.map((p) => p.id);
  const initialVoters: VotersByPlan = {};
  const venueSummaries = new Map<
    string,
    { label: string | null; total: number; optionCount: number }
  >();
  for (const p of upcoming) {
    for (const v of p.votes) {
      if (!v.user) continue;
      const list = initialVoters[p.id] ?? [];
      list.push({
        userId: v.user.id,
        displayName: v.user.displayName,
        avatarUrl: v.user.avatarUrl,
        status: v.status,
        votedAt: v.votedAt.toISOString(),
      });
      initialVoters[p.id] = list;
    }
    if (p.venues.length < 2) continue;
    let leaderLabel: string | null = null;
    let leaderVotes = 0;
    let tied = false;
    let total = 0;
    for (const venue of p.venues) {
      const count = venue.votes.length;
      total += count;
      if (count > leaderVotes) {
        leaderLabel = venue.label;
        leaderVotes = count;
        tied = false;
      } else if (count === leaderVotes && count > 0) {
        tied = true;
      }
    }
    venueSummaries.set(p.id, {
      label: tied || leaderVotes === 0 ? null : leaderLabel,
      total,
      optionCount: p.venues.length,
    });
  }

  const currentUser = {
    id: userId,
    displayName: me.user?.displayName ?? "You",
    avatarUrl: me.user?.avatarUrl ?? null,
  };

  // The hero is for a plan that still needs a decision. Locked plans remain
  // useful on home, but they belong in the compact "This week" list rather
  // than occupying the primary voting surface.
  const featured = upcoming.find((p) => p.status === "active") ?? null;
  const restUpcoming = featured
    ? upcoming.filter((p) => p.id !== featured.id)
    : upcoming;
  const dateLabel = formatDateHeader(now);
  const isEmpty = upcoming.length === 0;

  // M32.8 §4.6 — first pair of the viewer's hard commitments in this
  // circle whose windows overlap. Only one banner shows per page even if
  // three plans collide pairwise; the user resolves them one at a time.
  const collision = (() => {
    const committed = upcoming.filter((p) => {
      if (p.isApproximate) return false;
      if (p.timeMode !== "exact") return false;
      if (p.createdBy === userId) return true;
      const voters = initialVoters[p.id] ?? [];
      return voters.some((v) => v.userId === userId && v.status === "in");
    });
    for (let i = 0; i < committed.length; i += 1) {
      const a = committed[i]!;
      const aEnd = new Date(
        a.startsAt.getTime() + a.durationMinutes * 60_000,
      );
      for (let j = i + 1; j < committed.length; j += 1) {
        const b = committed[j]!;
        const bEnd = new Date(
          b.startsAt.getTime() + b.durationMinutes * 60_000,
        );
        if (a.startsAt < bEnd && b.startsAt < aEnd) {
          const [pairA, pairB] = [a.id, b.id].sort();
          return { planAId: pairA!, planBId: pairB! };
        }
      }
    }
    return null;
  })();

  const sidebarMembers = memberRows
    .map((m) =>
      m.user
        ? {
            userId: m.user.id,
            displayName: m.user.displayName,
            avatarUrl: m.user.avatarUrl,
          }
        : null,
    )
    .filter(
      (m): m is { userId: string; displayName: string; avatarUrl: string | null } =>
        m !== null,
    );

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl pb-32">
      {/* Desktop-only top row — kept for back-compat with the M31 sidebar
          chrome. Mobile uses the AppShell header. */}
      {isAdmin ? (
        <div className="hidden items-center justify-end gap-1 px-6 pt-3 md:flex">
          <Button asChild variant="ghost" size="icon" aria-label="Settings">
            <Link href={`/c/${circle.slug}/settings`}>
              <Settings />
            </Link>
          </Button>
          <UserButton />
        </div>
      ) : (
        <div className="hidden items-center justify-end gap-1 px-6 pt-3 md:flex">
          <UserButton />
        </div>
      )}

      <CircleVotesProvider
        initialVoters={initialVoters}
        members={members}
        knownPlanIds={planIds}
        currentUser={currentUser}
      >
        <div className="flex flex-col gap-4 px-4 pt-5 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-8">
          <div className="flex flex-col gap-5 lg:order-1">
            {/* Greeting row — replaces the old eyebrow + HeroQuestion +
                HomeSubline + WeatherChip stack. Mirrors the Spotlight
                design's intimate "Good evening, Sara · SUN MAY 10" hook
                while keeping the per-circle name in the eyebrow line for
                orientation. */}
            <header className="flex items-center gap-3">
              <GradientAvatar
                seed={currentUser.id}
                name={currentUser.displayName}
                src={currentUser.avatarUrl}
                size="md"
              />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold leading-tight text-ink">
                  <LocalGreeting initialHour={now.getHours()} />,{" "}
                  {firstName(currentUser.displayName)}
                </div>
                {/* Circle name is already in the AppShell top bar (mobile) /
                    Sidebar header (desktop) AND the spotlight card eyebrow.
                    Greeting row keeps only the date so the same string
                    isn't read three times on a single screen. */}
                <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                  {dateLabel}
                </div>
              </div>
            </header>

            <div className="flex flex-col gap-6">
              {!isEmpty ? (
                <HomePlanFeed
                  featured={
                    featured
                      ? {
                          id: featured.id,
                          title: featured.title,
                          startsAt: featured.startsAt,
                          timeZone: featured.timeZone,
                          isApproximate: featured.isApproximate,
                          location: featured.location,
                          status: featured.status,
                          decideBy: featured.decideBy,
                          creator: featured.createdBy
                            ? {
                                id: featured.createdBy,
                                displayName:
                                  featured.creator?.displayName ?? "Someone",
                                avatarUrl: featured.creator?.avatarUrl ?? null,
                              }
                            : null,
                          venueSummary: venueSummaries.get(featured.id) ?? null,
                        }
                      : null
                  }
                  restPlans={restUpcoming.map<ThisWeekListPlan>((p) => ({
                    id: p.id,
                    title: p.title,
                    type: p.type,
                    startsAt: p.startsAt,
                    timeZone: p.timeZone,
                    isApproximate: p.isApproximate,
                    location: p.location,
                    status: p.status,
                    venueSummary: venueSummaries.get(p.id) ?? null,
                  }))}
                  deckPlans={upcoming
                    .filter((p) => p.status !== "cancelled")
                    .map<HomeDeckPlan>((p) => ({
                      id: p.id,
                      title: p.title,
                      type: p.type,
                      startsAt: p.startsAt,
                      timeZone: p.timeZone,
                      isApproximate: p.isApproximate,
                      location: p.location,
                      status: p.status,
                      // PlansSwipeDeck doesn't render creator or comment count,
                      // but PlanCardData requires the fields. Pass placeholders
                      // so we don't pay for a comment-count round-trip the
                      // deck never reads.
                      creator: null,
                      commentCount: 0,
                    }))}
                  collision={collision}
                  circleName={circle.name}
                  slug={circle.slug}
                  now={now}
                />
              ) : isEmpty ? (
                // First-time users (no plan / vote anywhere) see the
                // teaching checklist. Anyone who's already engaged
                // with a plan — even just by voting — gets the calmer
                // orbital empty state instead. Keeps the onboarding
                // surface from re-appearing every time a circle goes
                // quiet between plans.
                hasUserActivity ? (
                  <OrbitalEmptyState>
                    <div className="hidden sm:inline-flex">
                      <NewPlanTrigger
                        circleId={circle.id}
                        slug={circle.slug}
                        members={formMembers}
                        currentUserId={userId}
                        mode="cta"
                      />
                    </div>
                  </OrbitalEmptyState>
                ) : (
                  <GetStartedChecklist
                    firstName={firstName(currentUser.displayName)}
                    memberCount={memberRows.length}
                    slug={circle.slug}
                    planSlot={
                      <NewPlanTrigger
                        circleId={circle.id}
                        slug={circle.slug}
                        members={formMembers}
                        currentUserId={userId}
                        mode="cta"
                      />
                    }
                  />
                )
              ) : (
                <NoUpcomingState />
              )}
            </div>
          </div>

          <aside className="hidden flex-col gap-4 lg:order-2 lg:flex">
            <Suspense fallback={<SquadPulseSkeleton variant="desktop" />}>
              <SquadPulseAsync
                circleId={circle.id}
                members={sidebarMembers}
                nowMs={now.getTime()}
                variant="desktop"
                featuredPlanId={featured?.id ?? null}
              />
            </Suspense>
            <Suspense fallback={<LockingSoonSkeleton />}>
              <LockingSoonPanel userId={userId} />
            </Suspense>
            <SuggestPanel
              circleId={circle.id}
              slug={circle.slug}
              members={formMembers}
              currentUserId={userId}
            />
          </aside>
        </div>
      </CircleVotesProvider>

      <Suspense fallback={null}>
        <PostJoinToast />
      </Suspense>
      {!hasUserActivity ? <FirstRunTour userId={userId} /> : null}
    </main>
  );
}

function NoUpcomingState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-ink/15 bg-paper-card/40 px-6 py-10 text-center">
      <span className="eyebrow text-ink-muted">Nothing scheduled</span>
      <p className="font-serif text-lg text-ink">
        Tap{" "}
        <em className="font-serif italic font-normal text-coral">+</em>{" "}
        to propose tonight.
      </p>
    </div>
  );
}
