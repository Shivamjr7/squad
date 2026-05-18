import Link from "next/link";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { circleDotClass } from "@/lib/circle-color";
import {
  formatRelativePastTime,
  formatRelativePlanTime,
} from "@/lib/format-relative-time";
import { FeedVoteAction } from "./feed-vote-action";
import { Pill, type PillTone } from "@/components/ui/pill";
import type { VoteStatus } from "@/lib/validation/vote";

// effectiveStatus is derived at read time from raw status + startsAt — see
// the cross-circle home (src/app/page.tsx). It's NEVER written to the DB;
// the source of truth stays plans.status, and a future pg_cron job should
// be the one flipping confirmed/active → done when startsAt+grace passes.
export type EffectiveStatus = "deciding" | "voting" | "locked" | "past";

export type FeedPlanCardData = {
  id: string;
  title: string;
  startsAt: Date;
  timeZone: string;
  isApproximate: boolean;
  status: "active" | "confirmed" | "done" | "cancelled";
  effectiveStatus: EffectiveStatus;
  circle: {
    id: string;
    slug: string;
    name: string;
  };
  // inCount = current "in" vote tally; voterCount = total votes cast (any
  // status); recipientCount = invited audience size (full circle if no
  // explicit recipients).
  inCount: number;
  voterCount: number;
  recipientCount: number;
  // The current viewer's vote on this plan, server-resolved. null = not
  // voted. Used to surface "You're In ✓" chip + Change vote link on the
  // Plans tab, or "You were In" muted label on past plans.
  myVote: VoteStatus | null;
  // UI Phase 7 — optional one-word vibe set at create time. Renders as
  // a small chip next to the status pill when present.
  vibe?: string | null;
};

// Status → pill tone. The left ribbon now carries CIRCLE identity (so
// each circle's cards form a visual cohort across the cross-circle feed);
// status is communicated by the pill + label, which is already where the
// eye lands.
const STATUS_STYLE: Record<
  EffectiveStatus,
  { tone: PillTone; label: string }
> = {
  deciding: { tone: "maybe", label: "Deciding" },
  voting: { tone: "voting", label: "Voting" },
  locked: { tone: "in", label: "Locked" },
  past: { tone: "muted", label: "Past" },
};

export function FeedPlanCard({
  plan,
  now,
  // Plans tab passes showVoteActions=true to surface the inline vote
  // buttons / "Change vote" link on each card. Circles-tab-only cards
  // (or other contexts) leave it off to render a quieter card.
  showVoteActions = false,
}: {
  plan: FeedPlanCardData;
  now: Date;
  showVoteActions?: boolean;
}) {
  const isPast = plan.effectiveStatus === "past";
  const isLocked = plan.effectiveStatus === "locked";
  const style = STATUS_STYLE[plan.effectiveStatus];
  const timeLine = isPast
    ? formatRelativePastTime(plan.startsAt, now, plan.timeZone)
    : formatRelativePlanTime(plan.startsAt, now, plan.timeZone);

  // Progress sliver math. The bar layers two fills: in-count (green) on
  // top of voter-count (muted), so a glance reveals both how many have
  // weighed in AND how many of those are committed-in. Falls back to a
  // single empty track when recipientCount is 0 (defensive).
  const recipients = Math.max(plan.recipientCount, 1);
  const votedPct = Math.min(100, (plan.voterCount / recipients) * 100);
  const inPct = Math.min(100, (plan.inCount / recipients) * 100);

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-ink-subtle bg-paper-card transition-shadow duration-200",
        // Hover lift via box-shadow only — explicitly NOT scale, per spec.
        "hover:shadow-card-raised",
        isPast && "opacity-60",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-0 bottom-0 left-0 w-1",
          // Past plans drop the chromatic ribbon — they shouldn't compete
          // for visual weight with active circles in the feed.
          isPast ? "bg-ink-subtle" : circleDotClass(plan.circle.id),
        )}
      />

      <div className="flex flex-col gap-3 px-4 py-4 pl-5 sm:px-5 sm:pl-6">
        {/* Circle attribution row — like a subreddit / account label */}
        <Link
          href={`/c/${plan.circle.slug}`}
          className="inline-flex w-fit items-center gap-1.5 text-xs text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              circleDotClass(plan.circle.id),
            )}
          />
          <span className="truncate font-medium text-ink/80">
            {plan.circle.name}
          </span>
        </Link>

        {/* Title — links to the plan detail. Hover hint via text color. */}
        <Link
          href={`/c/${plan.circle.slug}/p/${plan.id}`}
          className={cn(
            "rounded-md text-lg font-semibold leading-snug text-ink transition-colors hover:text-coral-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
            plan.status === "cancelled" && "line-through opacity-60",
          )}
        >
          {plan.title}
        </Link>

        {/* Status pill + vibe chip + relative time */}
        <div className="flex flex-wrap items-center gap-2">
          <Pill
            tone={style.tone}
            size="sm"
            leading={isLocked ? <Lock className="size-3" aria-hidden /> : null}
          >
            {style.label}
          </Pill>
          {plan.vibe ? (
            <Pill tone="ink" size="sm" variant="outline">
              {plan.vibe}
            </Pill>
          ) : null}
          <span className="text-sm text-ink-muted">{timeLine}</span>
        </div>

        {/* Vote progress — single sliver. Background = empty recipients;
            the wider underlay = total voters (any status); the narrower
            top fill = "in" voters. Far more glanceable than the dot row
            when recipientCount > 6. Hidden on past plans. */}
        {!isPast ? (
          <div className="flex flex-col gap-1.5">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={plan.recipientCount}
              aria-valuenow={plan.voterCount}
              aria-label={`${plan.voterCount} of ${plan.recipientCount} weighed in`}
              className={cn(
                "relative h-1.5 w-full overflow-hidden rounded-full bg-ink-subtle/40",
                isLocked && "opacity-60",
              )}
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 rounded-full bg-ink-muted/40 transition-[width] duration-300"
                style={{ width: `${votedPct}%` }}
              />
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 rounded-full bg-in transition-[width] duration-300"
                style={{ width: `${inPct}%` }}
              />
            </div>
            <span
              className={cn(
                "text-xs tabular-nums",
                isLocked ? "text-ink-muted" : "text-ink",
              )}
            >
              {isLocked
                ? `${plan.inCount} in`
                : `${plan.voterCount} of ${plan.recipientCount} weighed in`}
            </span>
          </div>
        ) : null}

        {/* Past plans never show vote UI — effectiveStatus check (Fix 3).
            Surface the user's historical vote as a muted label if they
            cast one before the plan slipped past. */}
        {isPast && plan.myVote ? (
          <p className="text-xs text-ink-muted">
            You were{" "}
            <span className="font-semibold capitalize">{plan.myVote}</span>.
          </p>
        ) : null}

        {/* Vote action — Plans tab only. Locked plans skip this too: the
            decision is made, vote-changing UX is hidden to avoid post-lock
            churn (users can still flip via the plan detail page). */}
        {showVoteActions && !isPast && !isLocked ? (
          <div className="pt-1">
            <FeedVoteAction
              planId={plan.id}
              initialVote={plan.myVote}
              shareContext={{
                title: plan.title,
                startsAt: plan.startsAt.toISOString(),
                circleSlug: plan.circle.slug,
                timeZone: plan.timeZone,
              }}
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}
