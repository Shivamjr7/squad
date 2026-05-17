import { Suspense } from "react";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ArrowLeft } from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  planEvents,
  planTimeProposals,
  planVenues,
  plans,
  timeSlots,
} from "@/db/schema";
import { canModifyPlan, requireDisplayNameSet } from "@/lib/auth";
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
import {
  ItsHappening,
  type ItsHappeningAddition,
} from "@/components/plan/its-happening";
import { SuggestAddition } from "@/components/plan/suggest-addition";
import { ConflictCompareLauncher } from "@/components/plan/conflict-compare-launcher";
import {
  getCompareSheetData,
  getConflictForVote,
} from "@/lib/actions/conflicts";
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
  type CircleMemberRow,
} from "@/lib/circles";
import {
  CircleVotesProvider,
  type Member,
  type VotersByPlan,
} from "@/lib/realtime/use-circle-votes";

// Server-rendered formatters must take an explicit timeZone — the Node
// runtime defaults to UTC on Vercel, which would make "Plan locks at …"
// read off by hours for any plan not in UTC.
function shortTime(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

function shortDay(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    timeZone,
  }).format(date);
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function relativeCreatedAt(createdAt: Date, now: Date, timeZone?: string): string {
  const diffMs = now.getTime() - createdAt.getTime();
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24 && isSameLocalDay(createdAt, now)) {
    return shortTime(createdAt, timeZone).toLowerCase().replace(" ", "");
  }
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(createdAt);
}

function statusLine(
  status: "active" | "confirmed" | "done" | "cancelled",
  startsAt: Date,
  decideBy: Date | null,
  now: Date,
  timeZone?: string,
): { label: string; tone: "deciding" | "confirmed" | "muted" } {
  if (status === "cancelled") {
    return { label: "Cancelled", tone: "muted" };
  }
  if (status === "done") {
    return { label: "Done", tone: "muted" };
  }
  if (status === "confirmed") {
    return {
      label: `Confirmed · ${shortDay(startsAt, timeZone).toUpperCase()} ${shortTime(startsAt, timeZone)}`,
      tone: "confirmed",
    };
  }
  // active
  if (decideBy && decideBy.getTime() > now.getTime()) {
    return {
      label: `Deciding now · Ends ${shortTime(decideBy, timeZone)}`,
      tone: "deciding",
    };
  }
  return { label: "Deciding now", tone: "deciding" };
}

export default async function PlanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; planId: string }>;
  searchParams: Promise<{ conflictWith?: string }>;
}) {
  const { slug, planId } = await params;
  const { conflictWith } = await searchParams;
  const { userId } = await auth();
  if (!userId) notFound();

  // One nested relational query for everything we need to render this
  // page. Folds the previous two-wave Promise.all (recipients + votes +
  // slots + venues + proposals + receipts, then slot/venue/proposal votes)
  // into a single round-trip via Drizzle's `with:` graph. The plan's
  // creator + member-side data (memberRows) is request-cached at the
  // layout level so this stays a single DB hit on the read path.
  const [, circle, planFull, userCircles] = await Promise.all([
    requireDisplayNameSet(userId),
    getCircleBySlug(slug),
    db.query.plans.findFirst({
      where: eq(plans.id, planId),
      with: {
        creator: {
          columns: { id: true, displayName: true, avatarUrl: true },
        },
        recipients: { columns: { userId: true } },
        votes: {
          with: {
            user: {
              columns: { id: true, displayName: true, avatarUrl: true },
            },
          },
        },
        timeSlots: {
          orderBy: asc(timeSlots.startsAt),
          columns: { id: true, startsAt: true },
          with: {
            votes: {
              with: {
                user: {
                  columns: { id: true, displayName: true, avatarUrl: true },
                },
              },
            },
          },
        },
        venues: {
          orderBy: asc(planVenues.createdAt),
          with: {
            suggester: { columns: { id: true, displayName: true } },
            votes: {
              with: {
                user: {
                  columns: { id: true, displayName: true, avatarUrl: true },
                },
              },
            },
          },
        },
        timeProposals: {
          orderBy: asc(planTimeProposals.createdAt),
          with: {
            proposer: { columns: { id: true, displayName: true } },
            votes: {
              with: {
                user: {
                  columns: { id: true, displayName: true, avatarUrl: true },
                },
              },
            },
          },
        },
        events: {
          orderBy: asc(planEvents.createdAt),
          with: { user: { columns: { displayName: true } } },
        },
      },
    }),
    getUserCircles(userId),
  ]);

  if (!circle) notFound();
  if (!planFull || planFull.circleId !== circle.id) notFound();
  const plan = planFull;

  // Members are layout-cached so this is request-scoped free.
  const memberRows = await getCircleMembers(circle.id) as CircleMemberRow[];
  const me = memberRows.find((m) => m.userId === userId);
  if (!me) notFound();

  const canMutateStatus = canModifyPlan(
    { createdBy: plan.createdBy },
    userId,
    { role: me.role },
  );

  const isOpenTime = plan.timeMode === "open" && plan.status === "active";
  const variant = getPlanVariant(plan, new Date());

  // Pull the nested arrays apart into the shapes the downstream JSX uses.
  // `timeProposals` is split into replacement vs addition because the UI
  // routes them to different components (proposals row vs. additions row).
  const recipientRows = plan.recipients;
  const voteRows = plan.votes;
  const slotRows = isOpenTime ? plan.timeSlots : [];
  const venueRows = plan.venues;
  const proposalRows = plan.timeProposals.filter(
    (p) => p.kind === "replacement",
  );
  const additionRows = plan.timeProposals.filter(
    (p) => p.kind === "addition",
  );
  const receiptEventRows = variant === "receipt" ? plan.events : [];
  // Vote arrays are nested under their parent rows by the relational
  // query; flatten only when the downstream code expects a flat list.
  const slotVoteRows = isOpenTime
    ? plan.timeSlots.flatMap((s) =>
        s.votes.map((v) => ({ ...v, slotId: s.id })),
      )
    : [];
  const venueVoteRows = plan.venues.flatMap((v) =>
    v.votes.map((vv) => ({ ...vv, venueId: v.id })),
  );
  const proposalVoteRows = proposalRows.flatMap((p) =>
    p.votes.map((pv) => ({ ...pv, proposalId: p.id })),
  );

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
  const status = statusLine(
    plan.status,
    plan.startsAt,
    plan.decideBy,
    now,
    plan.timeZone,
  );
  const memberCount = memberRows.length;
  // Clamp the M22 threshold down to the eligible voter pool so a plan in
  // a 4-person squad doesn't display the unreachable default of 5+ ins.
  // Covers plans created before the createPlan clamp landed too.
  const eligibleVoterCount = isAllRecipients
    ? memberCount
    : recipientIds.length;
  const lockThreshold = Math.max(
    1,
    Math.min(plan.lockThreshold, eligibleVoterCount),
  );

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

  // M31.8 — the "It's happening" surface pulls the lock timestamp + trigger
  // straight from the latest `locked` event so the green pill and the
  // subline copy ("auto-locked when consensus hit" vs. deadline vs. all-
  // voted) match the actual lock reason. Most plans have exactly one
  // locked event, but if a plan was unlocked and relocked we take the most
  // recent — `events` is already asc-sorted so it's the tail.
  const lockedEventRow =
    variant === "its-happening"
      ? [...plan.events].reverse().find((e) => e.kind === "locked")
      : null;
  const lockedAtIso = lockedEventRow?.createdAt.toISOString() ?? null;
  const lockedPayload =
    (lockedEventRow?.payload as Record<string, unknown> | null) ?? null;
  const lockTrigger = (() => {
    const raw = lockedPayload?.trigger;
    if (raw === "threshold" || raw === "forced" || raw === "all_voted") {
      return raw;
    }
    return null;
  })();
  const itsHappeningAdditions: ItsHappeningAddition[] = additionRows.map(
    (r) => ({
      id: r.id,
      label: r.label,
      startsAt: r.startsAt.toISOString(),
    }),
  );

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
  // Calendar links are null on past plans (Fix 3) — adding a past event
  // to your calendar isn't useful, and PlanDeepLinks handles null by
  // hiding the corresponding buttons.
  const ua = (await headers()).get("user-agent");
  const baseUrl = await getAppUrl();
  const planUrl = `${baseUrl}/c/${circle.slug}/p/${plan.id}`;
  const calendarDescription = `${circle.name} · Plan locked via Squad\n${planUrl}`;
  const mapsUrl = plan.location ? buildMapsUrl(plan.location, ua) : null;
  const icsUrl = isPastPlan ? null : `/api/plans/${plan.id}/ics`;
  const gcalUrl = isPastPlan
    ? null
    : buildGoogleCalendarUrl({
        title: plan.title,
        startsAt: plan.startsAt,
        location: plan.location,
        description: calendarDescription,
      });

  // M32.8 — if the URL carries ?conflictWith=<otherPlanId> (set by the
  // `plan_conflict` push composer), load both plans' compare-sheet data
  // server-side so the launcher opens without a fetch flash. Falls back to
  // null when the other plan isn't visible to the user — the launcher
  // simply doesn't mount in that case.
  const compareData =
    conflictWith && conflictWith !== plan.id
      ? await getCompareSheetData(plan.id, conflictWith)
      : null;

  // M32.8 §4.4 — lock-time conflict strip on the "It's happening" surface.
  // Only renders when the viewer is themselves committed to this confirmed
  // plan (IN vote or creator auto-in); otherwise "you're also in for X" is
  // a lie. We reuse `getConflictForVote`, which scans the user's other
  // hard commitments overlapping this plan's window.
  const myVoteOnPlan =
    voteRows.find((v) => v.userId === userId)?.status ?? null;
  const userIsCommittedHere =
    myVoteOnPlan === "in" || plan.createdBy === userId;
  const lockTimeConflict =
    variant === "its-happening" && userIsCommittedHere
      ? await getConflictForVote(plan.id)
      : null;

  return (
    <CircleVotesProvider
      initialVoters={initialVoters}
      members={members}
      knownPlanIds={[plan.id]}
      currentUser={currentUser}
    >
      {compareData ? (
        <ConflictCompareLauncher
          planAId={plan.id}
          initialData={compareData}
        />
      ) : null}
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
            {relativeCreatedAt(plan.createdAt, now, plan.timeZone)}{" "}
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
              lockThreshold={lockThreshold}
              currentInCount={currentInCount}
              now={now}
              timeZone={plan.timeZone}
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
        ) : variant === "its-happening" ? (
          <ItsHappening
            planId={plan.id}
            startsAt={plan.startsAt}
            timeZone={plan.timeZone}
            location={plan.location}
            recipientCount={recipientIds.length}
            inCount={currentInCount}
            lockedAtIso={lockedAtIso}
            lockTrigger={lockTrigger}
            additions={itsHappeningAdditions}
            mapsUrl={mapsUrl}
            icsUrl={icsUrl}
            commentsHref={`/c/${circle.slug}/p/${plan.id}#comments`}
            conflict={lockTimeConflict}
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
            isPast={isPastPlan}
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
                planDurationMinutes={plan.durationMinutes}
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
              <DecisionAdditions
                additions={additionsForTicker}
                timeZone={plan.timeZone}
              />
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
                  lockThreshold={lockThreshold}
                  currentInCount={currentInCount}
                  now={now}
                  timeZone={plan.timeZone}
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

        <section
          id="comments"
          className="flex flex-1 flex-col gap-3 border-t border-ink/10 pt-6 scroll-mt-16"
        >
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
  timeZone,
}: {
  additions: LiveTickerAddition[];
  timeZone?: string;
}) {
  const TIME = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
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

// Lock footer (PLAN.md §10 M22, refined post-launch). The plan locks on
// whichever of these fires first:
//   - `in` count hits `lock_threshold`
//   - `decide_by` deadline reached
//   - every eligible voter has voted (M29)
// When at threshold already, copy reads "Locking any moment now."
function LockFooter({
  status,
  decideBy,
  lockThreshold,
  currentInCount,
  now,
  timeZone,
}: {
  status: "active" | "confirmed" | "done" | "cancelled";
  decideBy: Date | null;
  lockThreshold: number;
  currentInCount: number;
  now: Date;
  timeZone?: string;
}) {
  if (status !== "active") return null;
  // The plan locks on the FIRST of these to fire:
  //   - lock_threshold `in` votes (M22 threshold path)
  //   - decide_by deadline (M22 forced path)
  //   - all eligible voters have voted (M29 all-voted path)
  // Earlier copy ("Plan locks at X if 5+ are in") read both clauses as a
  // single condition, which confused users who saw a deadline time and
  // expected it to be the plan start time. Rephrased so the deadline and
  // the threshold are clearly two independent triggers.
  const anchor = decideBy && decideBy.getTime() > now.getTime() ? decideBy : null;
  const remaining = Math.max(0, lockThreshold - currentInCount);
  let label: string;
  if (remaining <= 0) {
    label = "Locking any moment now";
  } else if (anchor) {
    label = `Locks at ${shortTime(anchor, timeZone)}, or sooner with ${lockThreshold}+ in`;
  } else {
    label = `Locks when ${lockThreshold}+ are in`;
  }
  return (
    <p className="pt-1 text-center eyebrow text-ink-muted">
      {label}
    </p>
  );
}
