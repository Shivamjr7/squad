import { Suspense } from "react";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { Settings } from "lucide-react";
import { and, asc, count, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  circles,
  comments,
  memberships,
  planVenueVotes,
  planVenues,
  plans,
  votes,
} from "@/db/schema";
import { Button } from "@/components/ui/button";
import { NewPlanTrigger } from "@/components/plan/new-plan-trigger";
import { PlanCard } from "@/components/plan/plan-card";
import { FeaturedPlanCard } from "@/components/plan/featured-plan-card";
import { UpcomingRow } from "@/components/plan/upcoming-row";
import { PostJoinToast } from "@/components/circle/post-join-toast";
import { CircleSwitcher } from "@/components/circle/circle-switcher";
import { BottomTabs } from "@/components/circle/bottom-tabs";
import { OrbitalEmptyState } from "@/components/plan/orbital-empty-state";
import type { FormMember } from "@/components/plan/new-plan-form";
import { getUserCircles } from "@/lib/circles";
import { requireDisplayNameSet } from "@/lib/auth";
import { buildMapsUrl } from "@/lib/maps";
import {
  CircleVotesProvider,
  type Member,
  type VotersByPlan,
} from "@/lib/realtime/use-circle-votes";

const DATE_ROW_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

function formatDateHeader(now: Date): string {
  // "SAT · APR 27" — short weekday + month/day, dot-separated, uppercased.
  const parts = DATE_ROW_FMT.formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${wd.toUpperCase()} · ${month.toUpperCase()} ${day}`;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isWeekend(d: Date): boolean {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

function pickHeroPrefix(
  nextPlan: { startsAt: Date } | undefined,
  now: Date,
): string {
  if (!nextPlan) return "What's the plan,";
  if (isSameLocalDay(nextPlan.startsAt, now)) return "Tonight,";
  const dayMs = 86_400_000;
  const diffMs = nextPlan.startsAt.getTime() - now.getTime();
  if (diffMs >= 0 && diffMs < 7 * dayMs && isWeekend(nextPlan.startsAt)) {
    return "This weekend,";
  }
  return "What's the plan,";
}

const PAST_COLLAPSE_THRESHOLD = 5;

export default async function CircleHomePage({
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

  const [memberRows, userCircles] = await Promise.all([
    db.query.memberships.findMany({
      where: eq(memberships.circleId, circle.id),
      orderBy: asc(memberships.joinedAt),
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
  const cancelledCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

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
      );

  const [upcoming, past] = await Promise.all([
    db.query.plans.findMany({
      where: and(
        eq(plans.circleId, circle.id),
        inArray(plans.status, ["active", "confirmed"]),
        gte(plans.startsAt, now),
        recipientVisibilityClause,
      ),
      orderBy: [
        sql`(${plans.status} = 'confirmed') desc`,
        asc(plans.startsAt),
      ],
      with: {
        creator: { columns: { displayName: true, avatarUrl: true } },
      },
    }),
    db.query.plans.findMany({
      where: and(
        eq(plans.circleId, circle.id),
        or(
          eq(plans.status, "done"),
          and(
            inArray(plans.status, ["active", "confirmed"]),
            lt(plans.startsAt, now),
          ),
          and(
            eq(plans.status, "cancelled"),
            gte(plans.cancelledAt, cancelledCutoff),
          ),
        ),
        recipientVisibilityClause,
      ),
      orderBy: desc(plans.startsAt),
      with: {
        creator: { columns: { displayName: true, avatarUrl: true } },
      },
    }),
  ]);

  const planIds = [...upcoming, ...past].map((p) => p.id);
  const upcomingPlanIds = upcoming.map((p) => p.id);
  const initialVoters: VotersByPlan = {};
  const commentCounts = new Map<string, number>();
  // Map<planId, { label, votes, total }> — surfaces the leading venue on the
  // home featured card + upcoming row when an active plan has multi-venue
  // voting in progress. Null leader (tie / no votes) shows "N options".
  const venueSummaries = new Map<
    string,
    { label: string | null; total: number; optionCount: number }
  >();
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
        votedAt: v.votedAt.toISOString(),
      });
      initialVoters[v.planId] = list;
    }
    for (const row of countRows) {
      commentCounts.set(row.planId, Number(row.n));
    }
  }

  if (upcomingPlanIds.length > 0) {
    const venueRows = await db
      .select({
        planId: planVenues.planId,
        venueId: planVenues.id,
        label: planVenues.label,
      })
      .from(planVenues)
      .where(inArray(planVenues.planId, upcomingPlanIds));

    if (venueRows.length > 0) {
      const venueIdToPlan = new Map<string, string>();
      const optionsPerPlan = new Map<string, number>();
      const labelByVenue = new Map<string, string>();
      for (const v of venueRows) {
        venueIdToPlan.set(v.venueId, v.planId);
        labelByVenue.set(v.venueId, v.label);
        optionsPerPlan.set(
          v.planId,
          (optionsPerPlan.get(v.planId) ?? 0) + 1,
        );
      }

      const voteRows = await db
        .select({
          venueId: planVenueVotes.venueId,
        })
        .from(planVenueVotes)
        .where(
          inArray(planVenueVotes.venueId, Array.from(venueIdToPlan.keys())),
        );

      // Tally votes per venue, then pick a unique leader per plan.
      const perVenueCount = new Map<string, number>();
      for (const r of voteRows) {
        perVenueCount.set(
          r.venueId,
          (perVenueCount.get(r.venueId) ?? 0) + 1,
        );
      }
      const perPlanLeader = new Map<
        string,
        { label: string; votes: number; tied: boolean }
      >();
      for (const [venueId, c] of perVenueCount.entries()) {
        const planId = venueIdToPlan.get(venueId);
        if (!planId) continue;
        const label = labelByVenue.get(venueId) ?? "";
        const cur = perPlanLeader.get(planId);
        if (!cur || c > cur.votes) {
          perPlanLeader.set(planId, { label, votes: c, tied: false });
        } else if (c === cur.votes) {
          perPlanLeader.set(planId, { ...cur, tied: true });
        }
      }
      // Total votes across this plan.
      const perPlanTotal = new Map<string, number>();
      for (const [venueId, c] of perVenueCount.entries()) {
        const planId = venueIdToPlan.get(venueId);
        if (!planId) continue;
        perPlanTotal.set(planId, (perPlanTotal.get(planId) ?? 0) + c);
      }

      for (const [planId, optionCount] of optionsPerPlan.entries()) {
        if (optionCount < 2) continue; // no need to surface for single-option seedings
        const leader = perPlanLeader.get(planId);
        const total = perPlanTotal.get(planId) ?? 0;
        venueSummaries.set(planId, {
          label: leader && !leader.tied && leader.votes > 0 ? leader.label : null,
          total,
          optionCount,
        });
      }
    }
  }

  const currentUser = {
    id: userId,
    displayName: me.user?.displayName ?? "You",
    avatarUrl: me.user?.avatarUrl ?? null,
  };

  const featured = upcoming[0];
  const restUpcoming = upcoming.slice(1);
  const heroPrefix = pickHeroPrefix(featured, now);
  const dateLabel = formatDateHeader(now);
  const isEmpty = upcoming.length === 0 && past.length === 0;

  // M25 — UA-aware Maps URL for the featured card. Skipped while venue
  // voting is in progress (no canonical address to point at yet).
  const ua = (await headers()).get("user-agent");
  const featuredMapsUrl =
    featured && featured.location && !venueSummaries.get(featured.id)
      ? buildMapsUrl(featured.location, ua)
      : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col pb-32">
      <header className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-6">
        <CircleSwitcher currentSlug={circle.slug} circles={userCircles} size="sm" />
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

      <div className="flex items-center justify-between gap-3 px-4 pt-6 sm:px-6">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
          {dateLabel}
        </span>
        <NewPlanTrigger
          circleId={circle.id}
          slug={circle.slug}
          members={formMembers}
          currentUserId={userId}
          mode="header"
        />
      </div>

      <h1 className="px-4 pt-3 pb-2 font-serif text-[34px] leading-[1.1] font-semibold text-ink sm:px-6 sm:text-[40px]">
        {heroPrefix}{" "}
        <em className="font-serif italic font-normal text-coral">
          {circle.name}
        </em>
        ?
      </h1>

      <CircleVotesProvider
        initialVoters={initialVoters}
        members={members}
        knownPlanIds={planIds}
        currentUser={currentUser}
      >
        <div className="flex flex-col gap-8 px-4 pt-4 sm:px-6">
          {featured ? (
            <FeaturedPlanCard
              plan={{
                id: featured.id,
                title: featured.title,
                startsAt: featured.startsAt,
                isApproximate: featured.isApproximate,
                location: featured.location,
                status: featured.status,
                decideBy: featured.decideBy,
                venueSummary: venueSummaries.get(featured.id) ?? null,
              }}
              slug={circle.slug}
              now={now}
              mapsUrl={featuredMapsUrl}
            />
          ) : isEmpty ? (
            <OrbitalEmptyState>
              <NewPlanTrigger
                circleId={circle.id}
                slug={circle.slug}
                members={formMembers}
                currentUserId={userId}
                mode="cta"
              />
            </OrbitalEmptyState>
          ) : (
            <NoUpcomingState />
          )}

          {restUpcoming.length > 0 ? (
            <section className="flex flex-col gap-3">
              <SectionHeader
                label="Upcoming"
                hint={`${upcoming.length} plan${upcoming.length === 1 ? "" : "s"}`}
              />
              <ul className="flex flex-col gap-1">
                {restUpcoming.map((p) => (
                  <li key={p.id}>
                    <UpcomingRow
                      plan={{
                        id: p.id,
                        title: p.title,
                        type: p.type,
                        startsAt: p.startsAt,
                        isApproximate: p.isApproximate,
                        location: p.location,
                        status: p.status,
                        venueSummary: venueSummaries.get(p.id) ?? null,
                      }}
                      slug={circle.slug}
                      now={now}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {past.length > 0 ? (
            <section className="flex flex-col gap-3">
              <SectionHeader label="Past" />
              {past.length > PAST_COLLAPSE_THRESHOLD ? (
                <details className="group rounded-lg">
                  <summary className="cursor-pointer list-none rounded-md px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper-card/60">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="transition-transform group-open:rotate-90">▸</span>
                      <span className="group-open:hidden">
                        Show {past.length} past plans
                      </span>
                      <span className="hidden group-open:inline">Hide past plans</span>
                    </span>
                  </summary>
                  <ul className="flex flex-col gap-3 pt-3">
                    {past.map((p) => (
                      <li key={p.id}>
                        <PlanCard
                          plan={{
                            ...p,
                            creator: p.creator ?? null,
                            commentCount: commentCounts.get(p.id) ?? 0,
                          }}
                          slug={circle.slug}
                          now={now}
                        />
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <ul className="flex flex-col gap-3">
                  {past.map((p) => (
                    <li key={p.id}>
                      <PlanCard
                        plan={{
                          ...p,
                          creator: p.creator ?? null,
                          commentCount: commentCounts.get(p.id) ?? 0,
                        }}
                        slug={circle.slug}
                        now={now}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </div>
      </CircleVotesProvider>

      <NewPlanTrigger
        circleId={circle.id}
        slug={circle.slug}
        members={formMembers}
        currentUserId={userId}
        mode="fab"
      />
      <BottomTabs slug={circle.slug} />
      <Suspense fallback={null}>
        <PostJoinToast />
      </Suspense>
    </main>
  );
}

function SectionHeader({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
        {label}
      </span>
      {hint ? (
        <span className="text-xs text-ink-muted">{hint}</span>
      ) : null}
    </div>
  );
}

function NoUpcomingState() {
  return (
    <div className="rounded-xl border border-dashed border-ink/15 bg-paper-card/40 px-6 py-8 text-center">
      <p className="text-sm text-ink-muted">
        Nothing scheduled. Tap + to propose tonight.
      </p>
    </div>
  );
}

