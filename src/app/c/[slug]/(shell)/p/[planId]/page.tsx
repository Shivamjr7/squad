import { Suspense } from "react";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ArrowLeft } from "lucide-react";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  planEvents,
  planRecipients,
  planTimeProposalVotes,
  planTimeProposals,
  planVenueVotes,
  planVenues,
  plans,
  timeSlotVotes,
  timeSlots,
  votes,
} from "@/db/schema";
import { canModifyPlan, requireDisplayNameSet } from "@/lib/auth";
import { tryAutoLock } from "@/lib/actions/auto-lock";
import { Button } from "@/components/ui/button";
import { formatPlanTime } from "@/lib/format-plan-time";
import { PlanVotes } from "@/components/votes/plan-votes";
import { VoterListDetail } from "@/components/votes/voter-list-detail";
import {
  PlanCommentsSection,
  PlanCommentsSkeleton,
} from "@/components/comments/plan-comments-section";
import { PlanOverflowMenu } from "@/components/plan/plan-overflow-menu";
import { DecisionCard } from "@/components/plan/decision-card";
import {
  LiveTicker,
  type LiveTickerAddition,
} from "@/components/plan/live-ticker";
import { Receipt, type ReceiptEvent } from "@/components/plan/receipt";
import { SuggestAddition } from "@/components/plan/suggest-addition";
import { getPlanVariant } from "@/lib/plan-variant";
import {
  TimeHeatmap,
  type HeatmapSlot,
} from "@/components/plan/time-heatmap";
import { VenueVote } from "@/components/plan/venue-vote";
import type {
  InitialVenueVoter,
  VenueMember,
  VenueRow,
} from "@/lib/realtime/use-venue-votes";
import { TimeProposals } from "@/components/plan/time-proposals";
import type {
  InitialProposalVoter,
  ProposalMember,
  ProposalRow,
} from "@/lib/realtime/use-time-proposals";
import type {
  InitialSlotVoter,
  SlotMember,
} from "@/lib/realtime/use-slot-votes";
import { CircleSwitcher } from "@/components/circle/circle-switcher";
import { PlanDeepLinks } from "@/components/plan/plan-deeplinks";
import { buildMapsUrl } from "@/lib/maps";
import { buildGoogleCalendarUrl } from "@/lib/calendar";
import { getAppUrl } from "@/lib/url";
import {
  PlanRecipientsSection,
  type RecipientCircleMember,
} from "@/components/plan/plan-recipients-section";
import {
  getCircleBySlug,
  getCircleMembers,
  getUserCircles,
} from "@/lib/circles";
import {
  CircleVotesProvider,
  type Member,
  type VotersByPlan,
} from "@/lib/realtime/use-circle-votes";

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

  // Fan out auth/circle/plan/userCircles + display-name check in parallel.
  // None depend on each other; sequential was costing ~5 roundtrips.
  const [, circle, initialPlan, userCircles] = await Promise.all([
    requireDisplayNameSet(userId),
    getCircleBySlug(slug),
    db.query.plans.findFirst({
      where: eq(plans.id, planId),
      with: {
        creator: { columns: { id: true, displayName: true, avatarUrl: true } },
      },
    }),
    getUserCircles(userId),
  ]);

  if (!circle) notFound();
  if (!initialPlan || initialPlan.circleId !== circle.id) notFound();

  // Members are layout-cached so this is request-scoped free.
  const memberRows = await getCircleMembers(circle.id);
  const me = memberRows.find((m) => m.userId === userId);
  if (!me) notFound();

  // M29 — idempotent recheck. Covers races where a vote slipped through
  // before the all-voted gate existed, or two voters tipped a threshold
  // simultaneously and one mutation skipped its lock attempt. tryAutoLock
  // short-circuits when the plan isn't lockable; on a successful flip we
  // refetch so the rendered status matches DB truth this request. Skip on
  // pure browse views — without `decide_by` already passed, the lock
  // conditions only flip on a write path (a vote), so the read-side
  // recheck does five DB queries for nothing on every active-plan visit.
  let plan = initialPlan;
  const couldPossiblyLockOnRead =
    plan.status === "active" &&
    plan.timeMode === "exact" &&
    plan.decideBy !== null &&
    plan.decideBy.getTime() <= Date.now();
  if (couldPossiblyLockOnRead) {
    const recheck = await tryAutoLock(planId);
    if (recheck.lockedNow) {
      const refreshed = await db.query.plans.findFirst({
        where: eq(plans.id, planId),
        with: {
          creator: {
            columns: { id: true, displayName: true, avatarUrl: true },
          },
        },
      });
      if (refreshed) plan = refreshed;
    }
  }

  const canMutateStatus = canModifyPlan(
    { createdBy: plan.createdBy },
    userId,
    { role: me.role },
  );

  const isOpenTime = plan.timeMode === "open" && plan.status === "active";
  const isActiveExact = plan.status === "active" && plan.timeMode === "exact";
  const variant = getPlanVariant(plan, new Date());

  // Fan out every independent plan-detail data query in a single Promise.all
  // — previously they ran sequentially (~8 roundtrips). Conditional helpers
  // skip work that's irrelevant to the current variant.
  const loadSlots = async () => {
    if (!isOpenTime) return [];
    return db.query.timeSlots.findMany({
      where: eq(timeSlots.planId, planId),
      orderBy: asc(timeSlots.startsAt),
      columns: { id: true, startsAt: true },
    });
  };
  const loadProposals = async () => {
    if (!isActiveExact) return [];
    return db.query.planTimeProposals.findMany({
      where: and(
        eq(planTimeProposals.planId, planId),
        eq(planTimeProposals.kind, "replacement"),
      ),
      orderBy: asc(planTimeProposals.createdAt),
      with: {
        proposer: { columns: { id: true, displayName: true } },
      },
    });
  };
  const loadReceiptEvents = async () => {
    if (variant !== "receipt") return [];
    return db.query.planEvents.findMany({
      where: eq(planEvents.planId, planId),
      orderBy: asc(planEvents.createdAt),
      with: {
        user: { columns: { displayName: true } },
      },
    });
  };
  // Comments are streamed via <PlanCommentsSection> below — not in this
  // Promise.all. They appear last in the visual order and don't gate any
  // earlier render decisions, so we let the page flush before fetching them.
  const [
    recipientRows,
    voteRows,
    slotRows,
    venueRows,
    proposalRows,
    additionRows,
    receiptEventRows,
  ] = await Promise.all([
    db
      .select({ userId: planRecipients.userId })
      .from(planRecipients)
      .where(eq(planRecipients.planId, planId)),
    db.query.votes.findMany({
      where: eq(votes.planId, planId),
      with: {
        user: {
          columns: { id: true, displayName: true, avatarUrl: true },
        },
      },
    }),
    loadSlots(),
    db.query.planVenues.findMany({
      where: eq(planVenues.planId, planId),
      orderBy: asc(planVenues.createdAt),
      with: {
        suggester: { columns: { id: true, displayName: true } },
      },
    }),
    loadProposals(),
    db.query.planTimeProposals.findMany({
      where: and(
        eq(planTimeProposals.planId, planId),
        eq(planTimeProposals.kind, "addition"),
      ),
      orderBy: asc(planTimeProposals.createdAt),
      with: {
        proposer: { columns: { id: true, displayName: true } },
      },
    }),
    loadReceiptEvents(),
  ]);

  // Fire the second-level dependent vote queries (slot votes, venue votes,
  // proposal votes) in parallel now that we have the parent IDs. These three
  // are independent of each other.
  const slotIds = slotRows.map((s) => s.id);
  const venueIds = venueRows.map((v) => v.id);
  const proposalIds = proposalRows.map((p) => p.id);
  const loadSlotVotes = async () => {
    if (!slotIds.length) return [];
    return db.query.timeSlotVotes.findMany({
      where: inArray(timeSlotVotes.slotId, slotIds),
      with: {
        user: { columns: { id: true, displayName: true, avatarUrl: true } },
      },
    });
  };
  const loadVenueVotes = async () => {
    if (!venueIds.length) return [];
    return db.query.planVenueVotes.findMany({
      where: inArray(planVenueVotes.venueId, venueIds),
      with: {
        user: { columns: { id: true, displayName: true, avatarUrl: true } },
      },
    });
  };
  const loadProposalVotes = async () => {
    if (!proposalIds.length) return [];
    return db.query.planTimeProposalVotes.findMany({
      where: inArray(planTimeProposalVotes.proposalId, proposalIds),
      with: {
        user: { columns: { id: true, displayName: true, avatarUrl: true } },
      },
    });
  };
  const [slotVoteRows, venueVoteRows, proposalVoteRows] = await Promise.all([
    loadSlotVotes(),
    loadVenueVotes(),
    loadProposalVotes(),
  ]);

  const isAllRecipients = recipientRows.length === 0;
  const recipientIds = isAllRecipients
    ? memberRows.map((m) => m.userId)
    : recipientRows.map((r) => r.userId);
  const recipientIdSet = new Set(recipientIds);
  const isRecipient = recipientIdSet.has(userId);
  const isAdmin = me.role === "admin";
  const canParticipate = isRecipient; // admins must self-add to vote (per spec)

  // Non-recipient + non-admin who navigates directly to the URL: render the
  // "you weren't invited" view instead of the full plan. Admins still see the
  // full plan (they can intervene if needed) but won't see vote buttons until
  // they add themselves to the recipient set.
  if (!isRecipient && !isAdmin) {
    return (
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
          </div>
        </header>
        <section className="mt-12 flex flex-col items-center gap-4 px-4 text-center">
          <span className="eyebrow text-ink-muted">
            Private plan
          </span>
          <h1 className="font-serif text-2xl font-semibold text-ink sm:text-3xl">
            You weren&rsquo;t invited to this one.
          </h1>
          <p className="max-w-sm text-sm text-ink-muted">
            Ask {plan.creator?.displayName ?? "the creator"} to add you if
            you&rsquo;d like to join.
          </p>
        </section>
      </main>
    );
  }

  const members: Record<string, Member> = {};
  for (const m of memberRows) {
    if (!m.user) continue;
    members[m.user.id] = {
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
    };
  }

  // Build voter map + tally `in` count in a single pass over voteRows.
  // (Previously a separate COUNT(*) query ran for the lock-footer; we already
  // have every vote here.)
  const initialVoters: VotersByPlan = {};
  let currentInCount = 0;
  for (const v of voteRows) {
    if (!v.user) continue;
    if (v.status === "in") currentInCount += 1;
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

  const openSlots: HeatmapSlot[] = slotRows.map((s) => ({
    id: s.id,
    startsAt: s.startsAt.toISOString(),
  }));
  const openInitialVoters: InitialSlotVoter[] = [];
  const openMembers: Record<string, SlotMember> = {};
  if (isOpenTime) {
    for (const sv of slotVoteRows) {
      openInitialVoters.push({ slotId: sv.slotId, userId: sv.userId });
      if (sv.user) {
        openMembers[sv.user.id] = {
          userId: sv.user.id,
          displayName: sv.user.displayName,
          avatarUrl: sv.user.avatarUrl,
        };
      }
    }
    // Ensure the current user is in members so they can optimistically vote
    // even if they haven't yet.
    if (me.user) {
      openMembers[me.user.id] = {
        userId: me.user.id,
        displayName: me.user.displayName,
        avatarUrl: me.user.avatarUrl,
      };
    }
  }

  const initialVenues: VenueRow[] = venueRows.map((v) => ({
    id: v.id,
    label: v.label,
    suggestedBy: v.suggestedBy,
    suggesterName: v.suggester?.displayName ?? null,
    createdAt: v.createdAt.toISOString(),
  }));
  const initialVenueVoters: InitialVenueVoter[] = [];
  const venueMembers: Record<string, VenueMember> = {};
  // Always seed the current user so they can optimistically vote.
  if (me.user) {
    venueMembers[me.user.id] = {
      userId: me.user.id,
      displayName: me.user.displayName,
      avatarUrl: me.user.avatarUrl,
    };
  }
  for (const vv of venueVoteRows) {
    initialVenueVoters.push({ venueId: vv.venueId, userId: vv.userId });
    if (vv.user) {
      venueMembers[vv.user.id] = {
        userId: vv.user.id,
        displayName: vv.user.displayName,
        avatarUrl: vv.user.avatarUrl,
      };
    }
  }
  const now = new Date();
  const isPastPlan =
    plan.status === "done" ||
    plan.status === "cancelled" ||
    plan.startsAt < now;

  // Surface multi-venue voting only while the plan is still active and has
  // more than one option. After lock (status=confirmed/done/cancelled) or a
  // past time, the canonical plan location is what matters; voting card hides.
  const showVenueVote =
    !isPastPlan && plan.status === "active" && initialVenues.length > 1;

  const initialProposals: ProposalRow[] = proposalRows.map((p) => ({
    id: p.id,
    startsAt: p.startsAt.toISOString(),
    proposedBy: p.proposedBy,
    proposerName: p.proposer?.displayName ?? null,
    createdAt: p.createdAt.toISOString(),
  }));
  const initialProposalVoters: InitialProposalVoter[] = [];
  const proposalMembers: Record<string, ProposalMember> = {};
  if (me.user) {
    proposalMembers[me.user.id] = {
      userId: me.user.id,
      displayName: me.user.displayName,
      avatarUrl: me.user.avatarUrl,
    };
  }
  for (const pv of proposalVoteRows) {
    initialProposalVoters.push({
      proposalId: pv.proposalId,
      userId: pv.userId,
    });
    if (pv.user) {
      proposalMembers[pv.user.id] = {
        userId: pv.user.id,
        displayName: pv.user.displayName,
        avatarUrl: pv.user.avatarUrl,
      };
    }
  }
  const showProposals =
    !isPastPlan && plan.status === "active" && plan.timeMode === "exact";

  const showVotes = !isPastPlan && (plan.status === "active" || plan.status === "confirmed");
  const status = statusLine(plan.status, plan.startsAt, plan.decideBy, now);
  const memberCount = memberRows.length;
  const lockThreshold = plan.lockThreshold;

  const additionsForTicker: LiveTickerAddition[] = additionRows.map((r) => ({
    id: r.id,
    label: r.label,
    startsAt: r.startsAt.toISOString(),
    proposerName: r.proposer?.displayName ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  const receiptEvents: ReceiptEvent[] = receiptEventRows.map((e) => ({
    id: e.id,
    kind: e.kind,
    actorName: e.user?.displayName ?? null,
    payload: (e.payload as Record<string, unknown> | null) ?? null,
    createdAt: e.createdAt.toISOString(),
  }));

  // M23 — recipient list (display-name + avatar) for the Squad section.
  // Sorted in circle-membership order (matches the home/squad strips).
  const circleMemberCards: RecipientCircleMember[] = memberRows
    .filter((m) => m.user)
    .map((m) => ({
      userId: m.user!.id,
      displayName: m.user!.displayName,
      avatarUrl: m.user!.avatarUrl,
    }));

  const isApprox = plan.isApproximate;

  // M25 — UA-aware Maps + calendar deep-links. Computed once on the server
  // so client components don't need to do their own UA sniffing or URL
  // building. mapsUrl is null when the plan has no canonical location yet.
  const ua = (await headers()).get("user-agent");
  const baseUrl = await getAppUrl();
  const planUrl = `${baseUrl}/c/${circle.slug}/p/${plan.id}`;
  const calendarDescription = `${circle.name} · Plan locked via Squad\n${planUrl}`;
  const mapsUrl = plan.location ? buildMapsUrl(plan.location, ua) : null;
  const icsUrl = `/api/plans/${plan.id}/ics`;
  const gcalUrl = buildGoogleCalendarUrl({
    title: plan.title,
    startsAt: plan.startsAt,
    location: plan.location,
    description: calendarDescription,
  });

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
          {canMutateStatus && !isPastPlan ? (
            <PlanOverflowMenu
              planId={plan.id}
              status={plan.status}
              circleSlug={circle.slug}
              planTitle={plan.title}
              planTimeLabel={formatPlanTime(plan.startsAt, isApprox, now, plan.timeZone)}
            />
          ) : null}
        </header>

        <section className="flex flex-col gap-3">
          <span
            className={
              "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 eyebrow tracking-[0.12em] " +
              (status.tone === "confirmed"
                ? "bg-in-soft text-in-strong"
                : status.tone === "deciding"
                  ? "bg-coral-soft text-coral-strong"
                  : "bg-paper text-ink-muted ring-1 ring-ink-subtle")
            }
          >
            {status.tone === "deciding" ? (
              // Same pulsing live-dot as the featured card so the visual
              // language for "decision in progress" is consistent across
              // surfaces. Plain check for confirmed; nothing for done/cancelled.
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-coral animate-pulse-soft"
              />
            ) : status.tone === "confirmed" ? (
              <span aria-hidden>✓</span>
            ) : null}
            {status.label}
          </span>
          <h1
            className={
              "font-serif text-3xl font-semibold leading-tight text-ink sm:text-4xl " +
              (plan.status === "cancelled" ? "line-through opacity-60" : "")
            }
            style={{ viewTransitionName: `plan-title-${plan.id}` }}
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

        {/* M24 — variant dispatch. Open-time plans (heatmap path) keep the
            decision-skin chrome regardless of variant since the live ticker
            assumes an exact time. Receipt + live-ticker render compact
            self-contained cards; decision falls back to the M16 stack. */}
        {isOpenTime ? (
          <>
            <TimeHeatmap
              planId={plan.id}
              slots={openSlots}
              initialVoters={openInitialVoters}
              members={openMembers}
              currentUserId={userId}
            />
            {canParticipate ? (
              <PlanVotes
                planId={plan.id}
                showFirstVoteHint
                density="detail"
                buttonSize="lg"
                showTally={false}
              />
            ) : (
              <NotInvitedNote creatorName={plan.creator?.displayName ?? null} />
            )}
            <VoterListDetail
              planId={plan.id}
              creatorId={plan.creator?.id ?? null}
            />
            <LockFooter
              status={plan.status}
              decideBy={plan.decideBy}
              startsAt={plan.startsAt}
              isApprox={isApprox}
              lockThreshold={lockThreshold}
              currentInCount={currentInCount}
              now={now}
            />
          </>
        ) : variant === "live-ticker" ? (
          <LiveTicker
            planId={plan.id}
            planTitle={plan.title}
            startsAt={plan.startsAt}
            timeZone={plan.timeZone}
            location={plan.location}
            decideBy={plan.decideBy}
            recipientCount={recipientIds.length}
            lockThreshold={lockThreshold}
            additions={additionsForTicker}
            shiftedFromTime={null}
            now={now}
            suggestAddOnSlot={
              canParticipate ? (
                <SuggestAddition
                  planId={plan.id}
                  defaultStartsAt={plan.startsAt}
                  tone="dark"
                />
              ) : null
            }
          />
        ) : variant === "receipt" ? (
          <Receipt
            planId={plan.id}
            planTitle={plan.title}
            startsAt={plan.startsAt}
            timeZone={plan.timeZone}
            location={plan.location}
            recipientCount={recipientIds.length}
            inCount={currentInCount}
            status={
              plan.status === "active" ? "confirmed" : plan.status
            }
            additions={additionsForTicker.map((a) => ({
              id: a.id,
              label: a.label,
              startsAt: a.startsAt,
            }))}
            events={receiptEvents}
            deepLinksSlot={
              <PlanDeepLinks
                mapsUrl={mapsUrl}
                icsUrl={icsUrl}
                gcalUrl={gcalUrl}
                location={plan.location}
                tone="cream"
              />
            }
            suggestAddOnSlot={
              canParticipate && plan.status === "confirmed" ? (
                <SuggestAddition
                  planId={plan.id}
                  defaultStartsAt={plan.startsAt}
                  tone="light"
                />
              ) : null
            }
          />
        ) : (
          <>
            <DecisionCard
              planId={plan.id}
              startsAt={plan.startsAt}
              timeZone={plan.timeZone}
              isApproximate={isApprox}
              location={plan.location}
              showVenueVote={showVenueVote}
              mapsUrl={mapsUrl}
              icsUrl={icsUrl}
              gcalUrl={gcalUrl}
              now={now}
            />
            {showVenueVote ? (
              <VenueVote
                planId={plan.id}
                initialVenues={initialVenues}
                initialVoters={initialVenueVoters}
                members={venueMembers}
                currentUserId={userId}
                canSuggest={plan.status === "active" && canParticipate}
              />
            ) : null}
            {showProposals ? (
              <TimeProposals
                planId={plan.id}
                initialProposals={initialProposals}
                initialVoters={initialProposalVoters}
                members={proposalMembers}
                currentUserId={userId}
                canSuggest={plan.status === "active" && canParticipate}
              />
            ) : null}
            {!isPastPlan && canParticipate ? (
              <SuggestAddition
                planId={plan.id}
                defaultStartsAt={plan.startsAt}
                tone="light"
              />
            ) : null}
            {additionsForTicker.length > 0 ? (
              <DecisionAdditions additions={additionsForTicker} />
            ) : null}
            {showVotes ? (
              <section className="flex flex-col gap-4">
                {canParticipate ? (
                  <PlanVotes
                    planId={plan.id}
                    showFirstVoteHint
                    density="detail"
                    buttonSize="lg"
                    showTally={false}
                  />
                ) : (
                  <NotInvitedNote
                    creatorName={plan.creator?.displayName ?? null}
                  />
                )}
                <VoterListDetail
                  planId={plan.id}
                  creatorId={plan.creator?.id ?? null}
                />
                <LockFooter
                  status={plan.status}
                  decideBy={plan.decideBy}
                  startsAt={plan.startsAt}
                  isApprox={isApprox}
                  lockThreshold={lockThreshold}
                  currentInCount={currentInCount}
                  now={now}
                />
              </section>
            ) : (
              <section className="flex flex-col gap-4">
                <VoterListDetail
                  planId={plan.id}
                  creatorId={plan.creator?.id ?? null}
                />
              </section>
            )}
          </>
        )}

        <PlanRecipientsSection
          planId={plan.id}
          circleMembers={circleMemberCards}
          recipientIds={recipientIds}
          isAll={isAllRecipients}
          canAdd={canMutateStatus}
          isPlanActive={plan.status === "active"}
        />

        <section className="flex flex-1 flex-col gap-3 border-t border-ink/10 pt-6">
          <h2 className="eyebrow text-ink-muted">
            Discussion
          </h2>
          <Suspense fallback={<PlanCommentsSkeleton />}>
            <PlanCommentsSection
              planId={plan.id}
              members={members}
              currentUser={currentUser}
              canCompose={canParticipate}
            />
          </Suspense>
        </section>
      </main>
    </CircleVotesProvider>
  );
}

function NotInvitedNote({ creatorName }: { creatorName: string | null }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-ink/15 bg-paper-card/40 px-6 py-8 text-center">
      <span className="eyebrow text-ink-muted">Not on the list</span>
      <p className="font-serif text-lg text-ink">
        Ask{" "}
        <em className="font-serif italic font-normal text-coral">
          {creatorName ?? "the creator"}
        </em>{" "}
        to add you.
      </p>
    </div>
  );
}

function DecisionAdditions({
  additions,
}: {
  additions: LiveTickerAddition[];
}) {
  const TIME = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return (
    <section className="flex flex-col gap-2">
      <span className="eyebrow text-ink-muted">
        Plus
      </span>
      <ul className="flex flex-col divide-y divide-ink/5 rounded-xl border border-ink/10 bg-paper-card/40">
        {additions.map((a) => (
          <li key={a.id} className="flex items-baseline gap-3 px-4 py-3">
            <span className="font-mono text-sm text-ink-muted tabular-nums">
              {TIME.format(new Date(a.startsAt))}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm text-ink">
                {a.label ?? "Add-on"}
              </span>
              {a.proposerName ? (
                <span className="text-[11px] text-ink-muted">
                  proposed by {a.proposerName}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// "PLAN LOCKS AT 8:30 IF 5+ ARE IN" footer (PLAN.md §10 M22). When the plan
// is already at threshold, copy reads "Plan locks any moment now". Confirmed
// plans show their locked time so people landing on the page after the lock
// see what just happened. We prefer plan.decideBy as the lock anchor when
// it's set; otherwise we fall back to the plan's startsAt for the time
// display so the line reads coherently for plans without a deadline.
function LockFooter({
  status,
  decideBy,
  startsAt,
  isApprox,
  lockThreshold,
  currentInCount,
  now,
}: {
  status: "active" | "confirmed" | "done" | "cancelled";
  decideBy: Date | null;
  startsAt: Date;
  isApprox: boolean;
  lockThreshold: number;
  currentInCount: number;
  now: Date;
}) {
  if (status !== "active") return null;
  const TIME = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const anchor = decideBy && decideBy.getTime() > now.getTime() ? decideBy : null;
  const remaining = Math.max(0, lockThreshold - currentInCount);
  let label: string;
  if (remaining <= 0) {
    label = "Locking any moment now";
  } else if (anchor) {
    label = `Plan locks at ${TIME.format(anchor)} if ${lockThreshold}+ are in`;
  } else if (!isApprox) {
    label = `Plan locks at ${TIME.format(startsAt)} if ${lockThreshold}+ are in`;
  } else {
    label = `Plan locks when ${lockThreshold}+ are in`;
  }
  return (
    <p className="pt-1 text-center eyebrow text-ink-muted">
      {label}
    </p>
  );
}
