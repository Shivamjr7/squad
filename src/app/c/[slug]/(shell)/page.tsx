import { Suspense } from "react";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { Settings } from "lucide-react";
import { and, asc, eq, gte, inArray, max, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  planEvents,
  planVenueVotes,
  planVenues,
  plans,
  pushSubscriptions,
  votes,
} from "@/db/schema";
import { Button } from "@/components/ui/button";
import { NewPlanTrigger } from "@/components/plan/new-plan-trigger";
import { FeaturedPlanCard } from "@/components/plan/featured-plan-card";
import {
  UpcomingStrip,
  type UpcomingStripPlan,
} from "@/components/plan/upcoming-strip";
import { PostJoinToast } from "@/components/circle/post-join-toast";
import { CircleSwitcher } from "@/components/circle/circle-switcher";
import { OrbitalEmptyState } from "@/components/plan/orbital-empty-state";
import { InstallBanner } from "@/components/pwa/install-banner";
import { EnablePushBanner } from "@/components/circle/enable-push-banner";
import { WeatherChip } from "@/components/circle/weather-chip";
import { HomeSubline } from "@/components/circle/home-subline";
import { SuggestPanel } from "@/components/circle/suggest-panel";
import {
  SquadPulseAsync,
  SquadPulseSkeleton,
} from "@/components/circle/squad-pulse-async";
import type { FormMember } from "@/components/plan/new-plan-form";
import {
  getCircleBySlug,
  getCircleMembers,
  getUserCircles,
  type CircleMemberRow,
  type UserCircle,
} from "@/lib/circles";
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

  // memberRows + userCircles are already cached at the layout level (same
  // request), so these calls hit the cache. pushRows is page-specific.
  const [memberRows, userCircles, pushRows] = await Promise.all([
    getCircleMembers(circle.id) as Promise<CircleMemberRow[]>,
    getUserCircles(userId) as Promise<UserCircle[]>,
    db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .limit(1),
  ]);
  const hasAnyPushSubscription = pushRows.length > 0;

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

  const upcoming = await db.query.plans.findMany({
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
  });

  const planIds = upcoming.map((p) => p.id);
  const upcomingPlanIds = upcoming.map((p) => p.id);
  const initialVoters: VotersByPlan = {};
  // Map<planId, { label, votes, total }> — surfaces the leading venue on the
  // home featured card + upcoming row when an active plan has multi-venue
  // voting in progress. Null leader (tie / no votes) shows "N options".
  const venueSummaries = new Map<
    string,
    { label: string | null; total: number; optionCount: number }
  >();
  if (planIds.length > 0) {
    const voteRows = await db.query.votes.findMany({
      where: inArray(votes.planId, planIds),
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
  const isEmpty = upcoming.length === 0;

  // M25 — UA-aware Maps URL for the featured card. Skipped while venue
  // voting is in progress (no canonical address to point at yet).
  const ua = (await headers()).get("user-agent");
  const featuredMapsUrl =
    featured && featured.location && !venueSummaries.get(featured.id)
      ? buildMapsUrl(featured.location, ua)
      : null;

  // Featured-plan "last edit Nm ago" — derived from MAX(plan_events.created_at)
  // (M24 activity log). Falls back to plan.createdAt if there are no events.
  let featuredLastEditAt: Date | null = null;
  if (featured) {
    const ev = await db
      .select({ at: max(planEvents.createdAt) })
      .from(planEvents)
      .where(eq(planEvents.planId, featured.id));
    featuredLastEditAt = ev[0]?.at ?? null;
  }

  // SquadPulse activity is streamed below via <SquadPulseAsync> in a
  // <Suspense> boundary so the two MAX() aggregations don't block first
  // paint. Members for the pulse come from `sidebarMembers` below.
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
    .filter((m): m is { userId: string; displayName: string; avatarUrl: string | null } => m !== null);

  // Subline computations.
  const decidingCount = upcoming.filter((p) => p.status === "active").length;
  const featuredVoters = featured
    ? new Set((initialVoters[featured.id] ?? []).map((v) => v.userId))
    : new Set<string>();
  const totalMembers = memberRows.length;

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl pb-32">
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

      <CircleVotesProvider
        initialVoters={initialVoters}
        members={members}
        knownPlanIds={planIds}
        currentUser={currentUser}
      >
        <div className="flex flex-col gap-4 px-4 pt-4 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-8">
          <div className="flex flex-col gap-6 lg:order-1">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="eyebrow text-ink-muted">
                  {dateLabel}
                </span>
                <WeatherChip />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="hidden sm:block">
                  <NewPlanTrigger
                    circleId={circle.id}
                    slug={circle.slug}
                    members={formMembers}
                    currentUserId={userId}
                    mode="header"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <h1 className="font-serif text-[34px] leading-[1.1] font-semibold text-ink sm:text-[40px]">
                {heroPrefix}{" "}
                <em className="font-serif italic font-normal text-coral">
                  {circle.name}
                </em>
                ?
              </h1>
              <HomeSubline
                decidingCount={decidingCount}
                decideBy={featured?.decideBy ?? null}
                weighedIn={featuredVoters.size}
                totalMembers={totalMembers}
                now={now}
              />
            </div>

            {/* Mobile-only inline pulse chips. Desktop has the full sidebar.
                Streamed via Suspense — the activity aggregate runs after
                first paint so the hero doesn't wait on it. */}
            <div className="lg:hidden">
              <Suspense fallback={<SquadPulseSkeleton variant="mobile" />}>
                <SquadPulseAsync
                  circleId={circle.id}
                  members={sidebarMembers}
                  nowMs={now.getTime()}
                  variant="mobile"
                />
              </Suspense>
            </div>

            <div className="flex flex-col gap-8">
              {featured ? (
                <FeaturedPlanCard
                  plan={{
                    id: featured.id,
                    title: featured.title,
                    startsAt: featured.startsAt,
                    timeZone: featured.timeZone,
                    isApproximate: featured.isApproximate,
                    location: featured.location,
                    status: featured.status,
                    decideBy: featured.decideBy,
                    venueSummary: venueSummaries.get(featured.id) ?? null,
                    creator: featured.creator
                      ? {
                          displayName: featured.creator.displayName,
                          avatarUrl: featured.creator.avatarUrl,
                        }
                      : null,
                    lastEditAt: featuredLastEditAt,
                    canEdit: isAdmin || featured.createdBy === userId,
                  }}
                  slug={circle.slug}
                  now={now}
                  mapsUrl={featuredMapsUrl}
                />
              ) : isEmpty ? (
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
                <NoUpcomingState />
              )}

              {/* Setup nudges live below the act-now content — they're useful
                  one-time prompts but should never push the featured card
                  below the fold on a 380px viewport. */}
              <InstallBanner />
              <EnablePushBanner hasAnySubscription={hasAnyPushSubscription} />

              {/* Mobile-only Suggest panel — desktop sees it in the right rail.
                  Replaces the M28 QuickNudge with the S6 suggest drawer entry. */}
              <div className="lg:hidden">
                <SuggestPanel
                  circleId={circle.id}
                  slug={circle.slug}
                  members={formMembers}
                  currentUserId={userId}
                />
              </div>

              {restUpcoming.length > 0 ? (
                <section className="flex flex-col gap-3">
                  <SectionHeader
                    label="Upcoming this week"
                    hint={`${upcoming.length} plan${upcoming.length === 1 ? "" : "s"}`}
                  />
                  <UpcomingStrip
                    plans={restUpcoming.map<UpcomingStripPlan>((p) => ({
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
                    slug={circle.slug}
                  />
                </section>
              ) : null}

              {/* Mobile-only Favourites strip — desktop has them in the
                  sidebar Favourites section. Horizontal scroll keeps the
                  vertical footprint small. */}
              {userCircles.length > 0 ? (
                <section className="lg:hidden flex flex-col gap-3">
                  <SectionHeader label="Favourites" />
                  <ul className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
                    {userCircles.map((c) => (
                      <li key={c.id} className="shrink-0">
                        <Link
                          href={`/c/${c.slug}`}
                          prefetch={false}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                            c.slug === circle.slug
                              ? "border-coral/40 bg-coral-soft/40 text-ink"
                              : "border-ink/10 bg-paper-card text-ink-muted hover:text-ink"
                          }`}
                        >
                          <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-full bg-ink/30"
                          />
                          <span className="font-medium text-ink">{c.name}</span>
                          <span className="text-[11px] text-ink-muted">
                            {c.role === "admin"
                              ? "admin"
                              : `${c.memberCount}`}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </div>

          <aside className="hidden flex-col gap-4 lg:order-2 lg:flex">
            <Suspense fallback={<SquadPulseSkeleton variant="desktop" />}>
              <SquadPulseAsync
                circleId={circle.id}
                members={sidebarMembers}
                nowMs={now.getTime()}
                variant="desktop"
              />
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

      <NewPlanTrigger
        circleId={circle.id}
        slug={circle.slug}
        members={formMembers}
        currentUserId={userId}
        mode="fab"
      />
      <Suspense fallback={null}>
        <PostJoinToast />
      </Suspense>
    </main>
  );
}

function SectionHeader({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-1">
      <span className="eyebrow text-ink-muted">
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

