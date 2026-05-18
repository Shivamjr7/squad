import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { ChevronRight, Plus } from "lucide-react";
import { and, asc, count, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  circles,
  memberships,
  planRecipients,
  plans,
  planVenues,
  planVenueVotes,
  votes,
} from "@/db/schema";
import { getMostRecentCircleSlug, requireDisplayNameSet } from "@/lib/auth";
import { getUnreadCount } from "@/lib/actions/notifications";
import { getUserCircles, type UserCircle } from "@/lib/circles";
import { circleDotClass } from "@/lib/circle-color";
import { cn } from "@/lib/utils";
import type { VoteStatus } from "@/lib/validation/vote";
import { SquadLogo } from "@/components/brand/squad-logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import {
  FeedPlanCard,
  type EffectiveStatus,
  type FeedPlanCardData,
} from "@/components/plan/feed-plan-card";
import {
  HomeTabSwitcher,
  type HomeTab,
} from "@/components/home/tab-switcher";
import {
  PlansFilters,
  type TimeFilter,
} from "@/components/home/plans-filters";
import { ShowPastClient } from "@/components/home/show-past-client";
import { LandingNav } from "@/components/landing/nav";
import { LandingHero } from "@/components/landing/hero";
import { LandingSocialProof } from "@/components/landing/social-proof";
import { LandingProblem } from "@/components/landing/problem";
import { LandingHowItWorks } from "@/components/landing/how-it-works";
import { LandingPlanCardExplainer } from "@/components/landing/plan-card-explainer";
import { LandingFeatureGrid } from "@/components/landing/feature-grid";
import { LandingStatsTestimonial } from "@/components/landing/stats-testimonial";
import { LandingFinalCta } from "@/components/landing/final-cta";
import { LandingFooter } from "@/components/landing/footer";
import { PrefetchCircle } from "@/components/home/prefetch-circle";
import { NotificationsBellLink } from "@/components/notifications/notifications-bell-link";

const FEED_LIMIT = 30;

type RawSearch = {
  tab?: string;
  circle?: string;
  time?: string;
  needs?: string;
  locked?: string;
  showPast?: string;
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<RawSearch>;
}) {
  const params = await searchParams;
  const tab: HomeTab = params.tab === "plans" ? "plans" : "circles";
  const { userId } = await auth();

  if (!userId) {
    return (
      <>
        <LandingNav />
        <main className="flex flex-col">
          <LandingHero />
          <LandingSocialProof />
          <LandingProblem />
          <LandingHowItWorks />
          <LandingPlanCardExplainer />
          <LandingFeatureGrid />
          <LandingStatsTestimonial />
          <LandingFinalCta />
        </main>
        <LandingFooter />
      </>
    );
  }

  await requireDisplayNameSet(userId);
  const fallbackSlug = await getMostRecentCircleSlug(userId);
  if (!fallbackSlug) redirect("/onboarding");

  return (
    <SignedInHome
      userId={userId}
      fallbackSlug={fallbackSlug}
      tab={tab}
      rawSearch={params}
    />
  );
}

async function SignedInHome({
  userId,
  fallbackSlug,
  tab,
  rawSearch,
}: {
  userId: string;
  fallbackSlug: string;
  tab: HomeTab;
  rawSearch: RawSearch;
}) {
  const [userCircles, unread] = await Promise.all([
    getUserCircles(userId),
    getUnreadCount().catch(() => 0),
  ]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 px-4 pt-3 pb-32 sm:px-6">
      <PrefetchCircle slug={fallbackSlug} />
      <header className="flex items-center justify-between gap-3">
        <Link
          href="/"
          aria-label="Squad — home"
          className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-ink transition-opacity hover:opacity-80"
        >
          <SquadLogo className="size-[18px] text-ink" />
          SQUAD
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <NotificationsBellLink slug={fallbackSlug} count={unread} />
          <UserButton />
        </div>
      </header>

      <div className="flex flex-col gap-3">
        <span className="eyebrow text-ink-muted">
          {tab === "circles" ? "Your circles" : "Across all your circles"}
        </span>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-serif text-[28px] leading-[1.1] font-semibold text-ink sm:text-[34px]">
            {tab === "circles" ? "Pick a circle." : "What's the move?"}
          </h1>
          <HomeTabSwitcher active={tab} />
        </div>
      </div>

      {tab === "circles" ? (
        <CirclesTab circles={userCircles} />
      ) : (
        <PlansTab
          userId={userId}
          userCircles={userCircles}
          rawSearch={rawSearch}
        />
      )}
    </main>
  );
}

// ─── Circles tab ────────────────────────────────────────────────────────

function CirclesTab({ circles: list }: { circles: UserCircle[] }) {
  if (list.length === 0) {
    // SignedInHome already redirects to /onboarding when there are no
    // memberships, so this state is unreachable in practice — keep the
    // explicit CTA anyway so the page doesn't dead-end if the redirect ever
    // races a stale render.
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-ink-subtle bg-paper-card/40 px-6 py-12 text-center text-sm text-ink-muted">
        <p>No circles yet.</p>
        <Link
          href="/onboarding?mode=create"
          className="inline-flex items-center gap-1.5 rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-coral/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          <Plus className="size-4" aria-hidden />
          New circle
        </Link>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {/* "+" tile lives at the top so it's reachable without scrolling
          past existing circles. Dashed border + ghost fill keeps it
          visually subordinate to actual circles. Routes to /onboarding
          with mode=create so the chooser step is skipped — see
          app/onboarding/page.tsx. */}
      <li>
        <Link
          href="/onboarding?mode=create"
          className="group flex h-full items-center gap-3 rounded-2xl border border-dashed border-ink-subtle bg-paper-card/40 p-4 transition-colors hover:border-coral/40 hover:bg-paper-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed border-ink-subtle text-ink-muted transition-colors group-hover:border-coral group-hover:text-coral"
          >
            <Plus className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium text-ink">Create a circle</span>
            <span className="text-xs text-ink-muted">
              Spin up a new squad
            </span>
          </div>
          <ChevronRight
            className="size-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      </li>
      {list.map((c) => (
        <li key={c.id}>
          <Link
            href={`/c/${c.slug}`}
            className="group flex items-center gap-3 rounded-2xl border border-ink-subtle bg-paper-card p-4 transition-shadow duration-200 hover:shadow-card-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            <span
              aria-hidden
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold uppercase text-white",
                circleDotClass(c.id),
              )}
            >
              {c.name.trim()[0]?.toUpperCase() ?? "?"}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium text-ink">{c.name}</span>
              <span className="text-xs text-ink-muted">
                {c.memberCount} {c.memberCount === 1 ? "person" : "people"}
                {c.role === "admin" ? " · admin" : ""}
              </span>
            </div>
            <ChevronRight
              className="size-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ─── Plans tab ──────────────────────────────────────────────────────────

type TimeBucket = "today" | "tomorrow" | "week" | "later" | "past";

const BUCKET_ORDER: TimeBucket[] = ["today", "tomorrow", "week", "later"];
const BUCKET_LABEL: Record<TimeBucket, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  week: "This week",
  later: "Later",
  past: "Past",
};

function ymdInZone(d: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(d);
}

function bucketFor(
  startsAt: Date,
  now: Date,
  timeZone: string,
): TimeBucket {
  if (startsAt.getTime() < now.getTime()) return "past";
  const today = ymdInZone(now, timeZone);
  const tomorrow = ymdInZone(
    new Date(now.getTime() + 86_400_000),
    timeZone,
  );
  const planDay = ymdInZone(startsAt, timeZone);
  if (planDay === today) return "today";
  if (planDay === tomorrow) return "tomorrow";
  const diffMs = startsAt.getTime() - now.getTime();
  if (diffMs < 7 * 86_400_000) return "week";
  return "later";
}

function timeFilterMatches(bucket: TimeBucket, filter: TimeFilter): boolean {
  if (filter === "today") return bucket === "today";
  if (filter === "week")
    return (
      bucket === "today" || bucket === "tomorrow" || bucket === "week"
    );
  if (filter === "later") return bucket === "later";
  return true;
}

async function PlansTab({
  userId,
  userCircles,
  rawSearch,
}: {
  userId: string;
  userCircles: UserCircle[];
  rawSearch: RawSearch;
}) {
  const circleFilter = rawSearch.circle ?? null;
  const timeFilter = (
    rawSearch.time === "today" || rawSearch.time === "week" || rawSearch.time === "later"
      ? rawSearch.time
      : null
  ) as TimeFilter | null;
  const needsVoteFilter = rawSearch.needs === "1";
  const lockedFilter = rawSearch.locked === "1";
  const showPast = rawSearch.showPast === "1";

  const now = new Date();

  // Cross-circle plans query — same shape as the original feed:
  //   JOIN plans → memberships (user filter) → circles. Recipient
  //   visibility is the implicit-full-circle OR explicit-recipient OR
  //   admin rule. Cancelled excluded; past INCLUDED so the Plans tab
  //   can surface them under the PAST bucket.
  //
  // Sort: 0 = active+upcoming, 1 = confirmed+upcoming, 2 = past. Within
  // each, soonest first. Past at the bottom so the buckets render top
  // down without needing a post-sort.
  const feedRows = await db
    .select({
      id: plans.id,
      title: plans.title,
      startsAt: plans.startsAt,
      timeZone: plans.timeZone,
      isApproximate: plans.isApproximate,
      status: plans.status,
      decideBy: plans.decideBy,
      timeMode: plans.timeMode,
      vibe: plans.vibe,
      circleId: circles.id,
      circleSlug: circles.slug,
      circleName: circles.name,
      membershipRole: memberships.role,
    })
    .from(plans)
    .innerJoin(
      memberships,
      and(
        eq(memberships.circleId, plans.circleId),
        eq(memberships.userId, userId),
      ),
    )
    .innerJoin(circles, eq(circles.id, plans.circleId))
    .where(
      and(
        ne(plans.status, "cancelled"),
        or(
          sql`NOT EXISTS (SELECT 1 FROM plan_recipients pr WHERE pr.plan_id = ${plans.id})`,
          sql`EXISTS (SELECT 1 FROM plan_recipients pr WHERE pr.plan_id = ${plans.id} AND pr.user_id = ${userId})`,
          eq(memberships.role, "admin"),
        ),
      ),
    )
    .orderBy(
      sql`CASE
        WHEN ${plans.status} = 'active' AND ${plans.startsAt} >= NOW() THEN 0
        WHEN ${plans.status} = 'confirmed' AND ${plans.startsAt} >= NOW() THEN 1
        ELSE 2
      END`,
      asc(plans.startsAt),
    )
    .limit(FEED_LIMIT);

  const planIds = feedRows.map((r) => r.id);
  const circleIds = Array.from(new Set(feedRows.map((r) => r.circleId)));

  const [voteRows, recipientRows, memberCountRows, venueOptionRows] =
    await Promise.all([
      planIds.length === 0
        ? []
        : db
            .select({
              planId: votes.planId,
              status: votes.status,
              userId: votes.userId,
            })
            .from(votes)
            .where(inArray(votes.planId, planIds)),
      planIds.length === 0
        ? []
        : db
            .select({ planId: planRecipients.planId })
            .from(planRecipients)
            .where(inArray(planRecipients.planId, planIds)),
      circleIds.length === 0
        ? []
        : db
            .select({ circleId: memberships.circleId, c: count() })
            .from(memberships)
            .where(inArray(memberships.circleId, circleIds))
            .groupBy(memberships.circleId),
      planIds.length === 0
        ? []
        : db
            .select({
              planId: planVenues.planId,
              venueId: planVenues.id,
              voteCount: count(planVenueVotes.id),
            })
            .from(planVenues)
            .leftJoin(
              planVenueVotes,
              eq(planVenueVotes.venueId, planVenues.id),
            )
            .where(inArray(planVenues.planId, planIds))
            .groupBy(planVenues.planId, planVenues.id),
    ]);

  const inCountByPlan = new Map<string, number>();
  const voterCountByPlan = new Map<string, number>();
  const myVoteByPlan = new Map<string, VoteStatus>();
  for (const v of voteRows) {
    voterCountByPlan.set(v.planId, (voterCountByPlan.get(v.planId) ?? 0) + 1);
    if (v.status === "in") {
      inCountByPlan.set(v.planId, (inCountByPlan.get(v.planId) ?? 0) + 1);
    }
    if (v.userId === userId) {
      myVoteByPlan.set(v.planId, v.status as VoteStatus);
    }
  }

  const recipientCountByPlan = new Map<string, number>();
  for (const r of recipientRows) {
    recipientCountByPlan.set(
      r.planId,
      (recipientCountByPlan.get(r.planId) ?? 0) + 1,
    );
  }

  const memberCountByCircle = new Map<string, number>();
  for (const row of memberCountRows) {
    memberCountByCircle.set(row.circleId, Number(row.c));
  }

  const venueOptionsByPlan = new Map<string, number>();
  for (const v of venueOptionRows) {
    venueOptionsByPlan.set(
      v.planId,
      (venueOptionsByPlan.get(v.planId) ?? 0) + 1,
    );
  }

  function deriveEffective(
    raw: "active" | "confirmed" | "done" | "cancelled",
    startsAt: Date,
    venueOptions: number,
    timeMode: "exact" | "open",
  ): EffectiveStatus {
    if (raw === "done") return "past";
    if (startsAt < now) return "past";
    if (raw === "confirmed") return "locked";
    if (venueOptions >= 2 || timeMode === "open") return "voting";
    return "deciding";
  }

  let decorated: FeedPlanCardData[] = feedRows.map((r) => ({
    id: r.id,
    title: r.title,
    startsAt: r.startsAt,
    timeZone: r.timeZone,
    isApproximate: r.isApproximate,
    status: r.status,
    effectiveStatus: deriveEffective(
      r.status,
      r.startsAt,
      venueOptionsByPlan.get(r.id) ?? 0,
      r.timeMode,
    ),
    circle: {
      id: r.circleId,
      slug: r.circleSlug,
      name: r.circleName,
    },
    inCount: inCountByPlan.get(r.id) ?? 0,
    voterCount: voterCountByPlan.get(r.id) ?? 0,
    recipientCount:
      recipientCountByPlan.get(r.id) ??
      memberCountByCircle.get(r.circleId) ??
      0,
    myVote: myVoteByPlan.get(r.id) ?? null,
    vibe: r.vibe,
  }));

  // Compute the "needs my vote" count BEFORE we narrow by the user's active
  // filters — the chip counter should always reflect total unvoted plans
  // across the user's accessible feed, not the (possibly filtered) view.
  const needsVoteCount = decorated.filter(
    (p) =>
      p.myVote === null &&
      (p.effectiveStatus === "deciding" || p.effectiveStatus === "voting"),
  ).length;

  // Apply filters (circle → time → needsVote → locked).
  if (circleFilter) {
    decorated = decorated.filter((p) => p.circle.slug === circleFilter);
  }
  if (lockedFilter) {
    decorated = decorated.filter((p) => p.effectiveStatus === "locked");
  }
  if (needsVoteFilter) {
    decorated = decorated.filter(
      (p) =>
        p.myVote === null &&
        (p.effectiveStatus === "deciding" || p.effectiveStatus === "voting"),
    );
  }

  // Time-bucket every plan, applying the optional time filter.
  const byBucket: Record<TimeBucket, FeedPlanCardData[]> = {
    today: [],
    tomorrow: [],
    week: [],
    later: [],
    past: [],
  };
  for (const p of decorated) {
    const b = bucketFor(p.startsAt, now, p.timeZone);
    if (timeFilter && !timeFilterMatches(b, timeFilter)) continue;
    byBucket[b].push(p);
  }

  const filtersList: FilterCircle[] = userCircles.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
  }));

  const hasUpcoming = BUCKET_ORDER.some((b) => byBucket[b].length > 0);
  const hasPast = byBucket.past.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <PlansFilters circles={filtersList} needsVoteCount={needsVoteCount} />

      {!hasUpcoming && !hasPast ? (
        <PlansEmpty />
      ) : (
        <div className="flex flex-col gap-6">
          {BUCKET_ORDER.map((bucket) =>
            byBucket[bucket].length === 0 ? null : (
              <BucketSection key={bucket} label={BUCKET_LABEL[bucket]}>
                <ul className="flex flex-col gap-3">
                  {byBucket[bucket].map((p) => (
                    <li key={p.id}>
                      <FeedPlanCard plan={p} now={now} showVoteActions />
                    </li>
                  ))}
                </ul>
              </BucketSection>
            ),
          )}

          {hasPast ? (
            <BucketSection label={BUCKET_LABEL.past}>
              {showPast ? (
                <ul className="flex flex-col gap-3">
                  {byBucket.past.map((p) => (
                    <li key={p.id}>
                      <FeedPlanCard plan={p} now={now} showVoteActions />
                    </li>
                  ))}
                </ul>
              ) : (
                <ShowPastLink count={byBucket.past.length} />
              )}
            </BucketSection>
          ) : null}
        </div>
      )}
    </div>
  );
}

type FilterCircle = {
  id: string;
  slug: string;
  name: string;
};

function BucketSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  // Sticky day eyebrow under the (already-sticky) filter strip. top-[3.25rem]
  // ≈ the filter-strip height; backdrop-blur + bg-paper/70 keeps the cards
  // legibly readable as they scroll under the label.
  return (
    <section className="flex flex-col gap-3">
      <div
        className={cn(
          "sticky top-[3.25rem] z-10 -mx-4 flex items-center gap-2 bg-paper/70 px-4 py-1.5 backdrop-blur",
          "supports-[backdrop-filter]:bg-paper/60 sm:-mx-6 sm:top-[3.5rem] sm:px-6",
        )}
      >
        <span className="eyebrow text-ink-muted">{label}</span>
        <span className="h-px flex-1 bg-ink-hairline" aria-hidden />
      </div>
      {children}
    </section>
  );
}

function ShowPastLink({ count }: { count: number }) {
  // URL-driven expand — preserves on back nav and shareable. We render a
  // link that flips the `showPast` flag while keeping every other filter.
  return (
    <ShowPastClient count={count} />
  );
}

function PlansEmpty() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-ink-subtle bg-paper-card/40 px-6 py-12 text-center">
      <div className="relative size-16">
        <span
          aria-hidden
          className="absolute left-1/2 top-1 size-3 -translate-x-1/2 rounded-full bg-coral"
        />
        <span
          aria-hidden
          className="absolute bottom-1 left-1 size-3 rounded-full bg-coral/60"
        />
        <span
          aria-hidden
          className="absolute right-1 bottom-1 size-3 rounded-full bg-coral/30"
        />
      </div>
      <p className="font-serif text-lg text-ink">
        No plans match those filters.
      </p>
      <p className="max-w-sm text-sm text-ink-muted">
        Clear a filter, switch circles, or start a new plan from inside any
        circle.
      </p>
    </div>
  );
}

