import Link from "next/link";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { circleDotClass } from "@/lib/circle-color";
import {
  formatRelativePastTime,
  formatRelativePlanTime,
} from "@/lib/format-relative-time";
import { FeedVoteAction } from "./feed-vote-action";
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
};

// Status → left-bar + pill color. Aligned to the design tokens we already
// have so the feed reads as part of the same system as in-circle cards.
const STATUS_STYLE: Record<
  EffectiveStatus,
  { bar: string; pill: string; label: string }
> = {
  deciding: {
    bar: "bg-maybe",
    pill: "bg-maybe-soft text-maybe-strong",
    label: "Deciding",
  },
  voting: {
    bar: "bg-blue-500",
    pill: "bg-blue-500/15 text-blue-300",
    label: "Voting",
  },
  locked: {
    bar: "bg-in",
    pill: "bg-in-soft text-in-strong",
    label: "Locked",
  },
  past: {
    bar: "bg-ink-subtle",
    pill: "bg-paper-card text-ink-muted ring-1 ring-ink-subtle",
    label: "Past",
  },
};

const MAX_DOTS = 10;

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
  const dotCount = Math.min(plan.recipientCount, MAX_DOTS);
  const overflow = Math.max(0, plan.recipientCount - MAX_DOTS);
  const timeLine = isPast
    ? formatRelativePastTime(plan.startsAt, now, plan.timeZone)
    : formatRelativePlanTime(plan.startsAt, now, plan.timeZone);

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
          style.bar,
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

        {/* Status pill + relative time */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
              style.pill,
            )}
          >
            {isLocked ? <Lock className="size-3" aria-hidden /> : null}
            {style.label}
          </span>
          <span className="text-sm text-ink-muted">{timeLine}</span>
        </div>

        {/* Vote progress — filled dots = weighed in, empty = pending.
            Hidden on past plans (vote section is muted per spec). */}
        {!isPast ? (
          <div className="flex flex-wrap items-center gap-3">
            <div
              className="flex items-center gap-1"
              aria-label={`${plan.voterCount} of ${plan.recipientCount} weighed in`}
            >
              {Array.from({ length: dotCount }).map((_, i) => {
                const filled = i < plan.voterCount;
                const isInVote = i < plan.inCount;
                return (
                  <span
                    key={i}
                    aria-hidden
                    className={cn(
                      "size-2 rounded-full transition-colors",
                      filled
                        ? isInVote
                          ? "bg-in"
                          : "bg-ink-muted/50"
                        : "border border-ink-subtle bg-paper",
                      // Mute the cluster on locked plans — the decision is
                      // made; the live vote progress no longer needs to
                      // pull the eye.
                      isLocked && "opacity-60",
                    )}
                  />
                );
              })}
              {overflow > 0 ? (
                <span className="ml-1 text-[11px] text-ink-muted tabular-nums">
                  +{overflow}
                </span>
              ) : null}
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
            <FeedVoteAction planId={plan.id} initialVote={plan.myVote} />
          </div>
        ) : null}
      </div>
    </article>
  );
}
