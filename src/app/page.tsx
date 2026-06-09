import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { ChevronRight } from "lucide-react";
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
import {
  getUserCircles,
  getUserCirclesActivity,
  type CircleActivity,
  type UserCircle,
} from "@/lib/circles";
import { users } from "@/db/schema";
import { circleDotClass } from "@/lib/circle-color";
import { cn } from "@/lib/utils";
import type { VoteStatus } from "@/lib/validation/vote";
import { SquadLogo } from "@/components/brand/squad-logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { GradientAvatar } from "@/components/ui/gradient-avatar";
import {
  FeedPlanCard,
  type EffectiveStatus,
  type FeedPlanCardData,
} from "@/components/plan/feed-plan-card";
import {
  PlansFilters,
  type TimeFilter,
} from "@/components/home/plans-filters";
import { ShowPastClient } from "@/components/home/show-past-client";
import { LandingNav } from "@/components/landing/nav";
import { LandingHero } from "@/components/landing/hero";
import { LandingProblem } from "@/components/landing/problem";
import { LandingHowItWorks } from "@/components/landing/how-it-works";
import { LandingPlanCardExplainer } from "@/components/landing/plan-card-explainer";
import { LandingFeatureGrid } from "@/components/landing/feature-grid";
import { LandingFinalCta } from "@/components/landing/final-cta";
import { LandingFooter } from "@/components/landing/footer";
import { PrefetchCircle } from "@/components/home/prefetch-circle";
import { NotificationsBellLink } from "@/components/notifications/notifications-bell-link";
import { LocalGreeting } from "@/components/home/local-greeting";
import { AddCircleMenu } from "@/components/home/add-circle-menu";
import {
  FirstRunTour,
  type FirstRunTourStep,
} from "@/components/onboarding/first-run-tour";

const FEED_LIMIT = 30;
type HomeView = "circles" | "plans";

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
  const tab: HomeView = params.tab === "plans" ? "plans" : "circles";
  const { userId } = await auth();

  if (!userId) {
    return (
      <>
        <LandingNav />
        <main className="flex flex-col">
          <LandingHero />
          <LandingProblem />
          <LandingHowItWorks />
          <LandingPlanCardExplainer />
          <LandingFeatureGrid />
          <LandingFinalCta />
        </main>
        <LandingFooter />
      </>
    );
  }

  await requireDisplayNameSet(userId);
  const fallbackSlug = await getMostRecentCircleSlug(userId);

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
  fallbackSlug: string | null;
  tab: HomeView;
  rawSearch: RawSearch;
}) {
  const [userCircles, unread, userRow] = await Promise.all([
    getUserCircles(userId),
    getUnreadCount().catch(() => 0),
    db.query.users.findFirst({
      columns: { displayName: true, avatarUrl: true },
      where: eq(users.id, userId),
    }),
  ]);

  // Per-circle activity in one grouped query, kicked off once we know
  // the user's circles + which they admin. Map<circleId, counts>.
  const adminCircleIds = userCircles
    .filter((c) => c.role === "admin")
    .map((c) => c.id);
  const activity = await getUserCirclesActivity(
    userId,
    userCircles.map((c) => c.id),
    adminCircleIds,
  );

  const displayName = userRow?.displayName ?? "you";
  const avatarUrl = userRow?.avatarUrl ?? null;
  const now = new Date();
  const needsVoteTotal = userCircles.reduce(
    (sum, circle) => sum + (activity.get(circle.id)?.needsVote ?? 0),
    0,
  );
  const decidingTotal = userCircles.reduce(
    (sum, circle) => sum + (activity.get(circle.id)?.deciding ?? 0),
    0,
  );
  const homeTourSteps: FirstRunTourStep[] = [
    userCircles.length === 0
      ? {
          title: "Add your first circle",
          body: "Start here. Create a circle for your squad, or join one with an invite link.",
          selectors: ['[data-tour="home-add-circle"]'],
        }
      : {
          title: "Select a circle",
          body: "Start here. Tap the squad you want to plan with, then you’ll land on that circle’s home.",
          selectors: ['[data-tour="home-circle-card"]'],
        },
    ...(userCircles.length > 0
      ? [
          {
            title: "Add a circle",
            body: "Use Add circle when you want to create a new squad or join one with an invite link.",
            selectors: ['[data-tour="home-add-circle"]'],
          },
          {
            title: "View all plans",
            body: "Use this secondary link when you want one feed of everything happening across your circles.",
            selectors: ['[data-tour="home-all-plans"]'],
          },
        ]
      : []),
  ];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 pt-3 pb-32 sm:px-6">
      {fallbackSlug ? <PrefetchCircle slug={fallbackSlug} /> : null}

      {/* Top bar — brandmark + chrome actions. The "New circle" chip
          sits here (not in the list) so it's reachable from any tab and
          doesn't compete with real circles for vertical space. */}
      <header className="flex items-center justify-between gap-3">
        <Link
          href="/"
          aria-label="Squad — home"
          className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-ink transition-opacity hover:opacity-80"
        >
          <SquadLogo className="size-[18px] text-ink" />
          SQUAD
        </Link>
        <div className="flex items-center gap-2">
          <AddCircleMenu />
          <ThemeToggle />
          {fallbackSlug ? (
            <NotificationsBellLink slug={fallbackSlug} count={unread} />
          ) : null}
          <UserButton />
        </div>
      </header>

      {tab === "circles" ? (
        <>
          <CircleLaunchHeader
            userId={userId}
            displayName={displayName}
            avatarUrl={avatarUrl}
            now={now}
            circleCount={userCircles.length}
            needsVoteCount={needsVoteTotal}
            decidingCount={decidingTotal}
          />
          <section className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="min-h-0 flex-1 overflow-y-auto pr-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <CirclesTab circles={userCircles} activity={activity} />
            </div>
            {userCircles.length > 0 ? (
              <Link
                href="/?tab=plans"
                data-tour="home-all-plans"
                className="group inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-ink/10 bg-paper-card text-sm font-semibold text-ink shadow-sm transition-colors hover:bg-ink/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper sm:w-auto sm:self-center sm:px-5"
              >
                View all plans
                <ChevronRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            ) : null}
          </section>
        </>
      ) : (
        <>
          <PlansLaunchHeader />
          <PlansTab
            userId={userId}
            userCircles={userCircles}
            rawSearch={rawSearch}
          />
        </>
      )}
      {tab === "circles" ? (
        <FirstRunTour userId={userId} tourId="home" steps={homeTourSteps} />
      ) : null}
    </main>
  );
}

function firstNameOf(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0]!;
}

const DATE_ROW_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});
function dateLabel(now: Date): string {
  const parts = DATE_ROW_FMT.formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${wd.toUpperCase()} · ${month.toUpperCase()} ${day}`;
}

function CircleLaunchHeader({
  userId,
  displayName,
  avatarUrl,
  now,
  circleCount,
  needsVoteCount,
  decidingCount,
}: {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  now: Date;
  circleCount: number;
  needsVoteCount: number;
  decidingCount: number;
}) {
  return (
    <section className="flex flex-col gap-5 pt-1">
      <div className="flex items-center gap-3">
        {circleCount > 0 ? (
          <GradientAvatar
            seed={userId}
            name={displayName}
            src={avatarUrl}
            size="md"
          />
        ) : null}
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold leading-tight text-ink">
            <LocalGreeting initialHour={now.getHours()} />,{" "}
            {firstNameOf(displayName)}
          </div>
          <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            {dateLabel(now)}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-col gap-1">
            <h1 className="font-serif text-[34px] leading-[1.02] font-semibold text-ink sm:text-[42px]">
              {circleCount === 0 ? "Add your first circle" : "Choose a circle"}
            </h1>
            <p className="max-w-md text-sm leading-relaxed text-ink-muted">
              {circleCount === 0
                ? "Create a private space for your squad, or join one with an invite link."
                : "Pick where you want to plan today."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusChip
            label={
              circleCount === 1 ? "1 circle" : `${circleCount} circles`
            }
          />
          {needsVoteCount > 0 ? (
            <StatusChip label={`${needsVoteCount} need your vote`} tone="coral" />
          ) : decidingCount > 0 ? (
            <StatusChip label={`${decidingCount} deciding`} tone="ink" />
          ) : (
            <StatusChip label="Quiet right now" />
          )}
        </div>
      </div>
    </section>
  );
}

function PlansLaunchHeader() {
  return (
    <section className="flex flex-col gap-3 pt-1">
      <Link
        href="/"
        className="inline-flex w-fit items-center gap-1 rounded-full px-1 py-1 text-xs font-semibold text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        <ChevronRight className="size-3.5 rotate-180" aria-hidden />
        Circles
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-[34px] leading-[1.02] font-semibold text-ink sm:text-[42px]">
          All plans
        </h1>
        <p className="max-w-md text-sm leading-relaxed text-ink-muted">
          Everything happening across your circles.
        </p>
      </div>
    </section>
  );
}

function StatusChip({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "muted" | "coral" | "ink";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold",
        tone === "coral"
          ? "border-coral/25 bg-coral/10 text-coral"
          : tone === "ink"
            ? "border-ink/12 bg-ink/[0.06] text-ink"
            : "border-ink/10 bg-paper-card text-ink-muted",
      )}
    >
      {label}
    </span>
  );
}

// ─── Circles tab ────────────────────────────────────────────────────────

function CirclesTab({
  circles: list,
  activity,
}: {
  circles: UserCircle[];
  activity: Map<string, CircleActivity>;
}) {
  if (list.length === 0) {
    return <AddCircleMenu variant="empty" />;
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {list.map((c) => {
        const a = activity.get(c.id) ?? { deciding: 0, locked: 0, needsVote: 0 };
        const meta = formatActivity(a);
        const hot = a.needsVote > 0;
        return (
          <li key={c.id}>
            <Link
              href={`/c/${c.slug}`}
              data-tour="home-circle-card"
              className={cn(
                "group relative flex min-h-[92px] items-center gap-3 rounded-lg border bg-paper-card px-3.5 py-3.5 shadow-sm transition-all duration-200",
                "hover:-translate-y-0.5 hover:shadow-card-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
                hot ? "border-coral/35" : "border-ink/10",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "relative flex size-12 shrink-0 items-center justify-center rounded-full text-base font-semibold uppercase text-white shadow-sm",
                  circleDotClass(c.id),
                )}
              >
                {c.name.trim()[0]?.toUpperCase() ?? "?"}
                {hot ? (
                  <span
                    aria-label="needs your vote"
                    className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-coral ring-2 ring-paper-card"
                  />
                ) : null}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[17px] font-semibold leading-tight text-ink">
                  {c.name}
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <span
                    className={cn(
                      "inline-flex h-6 max-w-full items-center rounded-full border px-2 font-semibold",
                      meta.tone === "coral"
                        ? "border-coral/25 bg-coral/10 text-coral"
                        : meta.tone === "ink"
                          ? "border-ink/10 bg-ink/[0.05] text-ink"
                          : "border-ink/8 bg-ink/[0.03] text-ink-muted",
                    )}
                  >
                    {meta.label}
                  </span>
                  <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/8 bg-ink/[0.03] px-2 font-medium text-ink-muted">
                    {c.memberCount} {c.memberCount === 1 ? "person" : "people"}
                  </span>
                  {c.role === "admin" ? (
                    <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/8 bg-ink/[0.03] px-2 font-medium text-ink-muted">
                      admin
                    </span>
                  ) : null}
                </span>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                {hot ? (
                  <span className="hidden rounded-full bg-coral px-2.5 py-1 text-xs font-semibold text-white sm:inline-flex">
                    Vote
                  </span>
                ) : null}
                <ChevronRight
                  className="size-4 text-ink-muted transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// Formats the activity counts into a single readable line + visual
// tone. Order of precedence: needs-vote > deciding > locked > quiet.
// Only the top signal shows — stacking all three reads as noise on a
// list row that has limited width.
function formatActivity(a: CircleActivity): {
  label: string;
  tone: "coral" | "ink" | "muted";
} {
  if (a.needsVote > 0) {
    return {
      label: `${a.needsVote} need${a.needsVote === 1 ? "s" : ""} your vote`,
      tone: "coral",
    };
  }
  if (a.deciding > 0 && a.locked > 0) {
    return {
      label: `${a.deciding} deciding · ${a.locked} locked`,
      tone: "ink",
    };
  }
  if (a.deciding > 0) {
    return { label: `${a.deciding} deciding`, tone: "ink" };
  }
  if (a.locked > 0) {
    return { label: `${a.locked} locked`, tone: "ink" };
  }
  return { label: "Quiet right now", tone: "muted" };
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
      lockThreshold: plans.lockThreshold,
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
          eq(plans.createdBy, userId),
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
    decideBy: Date | null,
    inCount: number,
    lockThreshold: number,
  ): EffectiveStatus {
    if (raw === "done") return "past";
    if (startsAt < now) return "past";
    if (raw === "confirmed") return "locked";
    // Active plan whose decide_by has slipped past without the threshold
    // being hit. No cron force-locks today, so the plan sits in limbo —
    // surface it as "lapsed" instead of lying with "deciding" / "locking".
    if (
      decideBy &&
      decideBy.getTime() <= now.getTime() &&
      inCount < lockThreshold
    ) {
      return "lapsed";
    }
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
      r.decideBy,
      inCountByPlan.get(r.id) ?? 0,
      r.lockThreshold,
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
