import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ArrowLeft } from "lucide-react";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  circles,
  comments,
  memberships,
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
import { Button } from "@/components/ui/button";
import { formatPlanTime } from "@/lib/format-plan-time";
import { PlanVotes } from "@/components/votes/plan-votes";
import { VoterListDetail } from "@/components/votes/voter-list-detail";
import { PlanComments } from "@/components/comments/plan-comments";
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
import { BottomTabs } from "@/components/circle/bottom-tabs";
import { PlanDeepLinks } from "@/components/plan/plan-deeplinks";
import { buildMapsUrl } from "@/lib/maps";
import { buildGoogleCalendarUrl } from "@/lib/calendar";
import { getAppUrl } from "@/lib/url";
import {
  PlanRecipientsSection,
  type RecipientCircleMember,
} from "@/components/plan/plan-recipients-section";
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

  // M23 — load explicit recipient set. Empty rows = full circle (back-compat
  // for plans created before M23).
  const recipientRows = await db
    .select({ userId: planRecipients.userId })
    .from(planRecipients)
    .where(eq(planRecipients.planId, planId));
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
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
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
        <BottomTabs slug={circle.slug} />
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

  const isOpenTime = plan.timeMode === "open" && plan.status === "active";

  let openSlots: HeatmapSlot[] = [];
  const openInitialVoters: InitialSlotVoter[] = [];
  const openMembers: Record<string, SlotMember> = {};
  if (isOpenTime) {
    const slotRows = await db.query.timeSlots.findMany({
      where: eq(timeSlots.planId, planId),
      orderBy: asc(timeSlots.startsAt),
      columns: { id: true, startsAt: true },
    });
    openSlots = slotRows.map((s) => ({
      id: s.id,
      startsAt: s.startsAt.toISOString(),
    }));
    if (slotRows.length > 0) {
      const slotVoteRows = await db.query.timeSlotVotes.findMany({
        where: inArray(
          timeSlotVotes.slotId,
          slotRows.map((s) => s.id),
        ),
        with: {
          user: { columns: { id: true, displayName: true, avatarUrl: true } },
        },
      });
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

  // M21: load venue rows + their votes. When >1 venue exists we render the
  // multi-venue voting card; the leading venue's label is also surfaced on
  // the home featured card / upcoming row at lock time.
  const venueRows = await db.query.planVenues.findMany({
    where: eq(planVenues.planId, planId),
    orderBy: asc(planVenues.createdAt),
    with: {
      suggester: { columns: { id: true, displayName: true } },
    },
  });
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
  if (venueRows.length > 0) {
    const venueVoteRows = await db.query.planVenueVotes.findMany({
      where: inArray(
        planVenueVotes.venueId,
        venueRows.map((v) => v.id),
      ),
      with: {
        user: { columns: { id: true, displayName: true, avatarUrl: true } },
      },
    });
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
  }
  // Surface multi-venue voting only while the plan is still active and has
  // more than one option. After lock (status=confirmed/done/cancelled) the
  // canonical plans.location is what matters; voting card hides.
  const showVenueVote =
    plan.status === "active" && initialVenues.length > 1;

  // M22 — load time proposals + their votes for exact-time plans. Only shown
  // while active; once locked / done / cancelled, plan.startsAt is the truth.
  // M24 — only `replacement` rows feed the M22 voting UI; additions are
  // loaded separately below.
  const proposalRows =
    plan.status === "active" && plan.timeMode === "exact"
      ? await db.query.planTimeProposals.findMany({
          where: and(
            eq(planTimeProposals.planId, planId),
            eq(planTimeProposals.kind, "replacement"),
          ),
          orderBy: asc(planTimeProposals.createdAt),
          with: {
            proposer: { columns: { id: true, displayName: true } },
          },
        })
      : [];
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
  if (proposalRows.length > 0) {
    const proposalVoteRows = await db.query.planTimeProposalVotes.findMany({
      where: inArray(
        planTimeProposalVotes.proposalId,
        proposalRows.map((p) => p.id),
      ),
      with: {
        user: { columns: { id: true, displayName: true, avatarUrl: true } },
      },
    });
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
  }
  const showProposals =
    plan.status === "active" && plan.timeMode === "exact";

  // "PLAN LOCKS AT 8:30 IF 5+ ARE IN" footer — only meaningful while the
  // plan is still gathering votes.
  const lockThreshold = plan.lockThreshold;
  const inCountRow = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(votes)
    .where(and(eq(votes.planId, planId), eq(votes.status, "in")));
  const currentInCount = Number(inCountRow[0]?.n ?? 0);

  const now = new Date();
  const showVotes = plan.status === "active" || plan.status === "confirmed";
  const status = statusLine(plan.status, plan.startsAt, plan.decideBy, now);
  const memberCount = memberRows.length;

  // M24 — load addition rows (kind=addition) for the live-ticker PLUS row
  // and the receipt AFTER row. Always loaded; the components decide whether
  // to surface them.
  const additionRows = await db.query.planTimeProposals.findMany({
    where: and(
      eq(planTimeProposals.planId, planId),
      eq(planTimeProposals.kind, "addition"),
    ),
    orderBy: asc(planTimeProposals.createdAt),
    with: {
      proposer: { columns: { id: true, displayName: true } },
    },
  });
  const additionsForTicker: LiveTickerAddition[] = additionRows.map((r) => ({
    id: r.id,
    label: r.label,
    startsAt: r.startsAt.toISOString(),
    proposerName: r.proposer?.displayName ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  // M24 — receipt activity log. Loaded only for the receipt variant to keep
  // the decision/live-ticker page weight low.
  const variant = getPlanVariant(plan, now);
  let receiptEvents: ReceiptEvent[] = [];
  if (variant === "receipt") {
    const eventRows = await db.query.planEvents.findMany({
      where: eq(planEvents.planId, planId),
      orderBy: asc(planEvents.createdAt),
      with: {
        user: { columns: { displayName: true } },
      },
    });
    receiptEvents = eventRows.map((e) => ({
      id: e.id,
      kind: e.kind,
      actorName: e.user?.displayName ?? null,
      payload: (e.payload as Record<string, unknown> | null) ?? null,
      createdAt: e.createdAt.toISOString(),
    }));
  }

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
            {canParticipate ? (
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
            ) : null}
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
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
            Discussion
          </h2>
          <PlanComments
            planId={plan.id}
            members={members}
            initialComments={initialComments}
            currentUser={currentUser}
            canCompose={canParticipate}
          />
        </section>
        <BottomTabs slug={circle.slug} />
      </main>
    </CircleVotesProvider>
  );
}

function NotInvitedNote({ creatorName }: { creatorName: string | null }) {
  return (
    <p className="rounded-2xl border border-dashed border-ink/15 bg-paper-card/40 px-4 py-3 text-sm text-ink-muted">
      You weren&rsquo;t invited to this one — ask{" "}
      {creatorName ?? "the creator"} to add you.
    </p>
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
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
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
    <p className="pt-1 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
      {label}
    </p>
  );
}
