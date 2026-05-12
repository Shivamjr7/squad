import Link from "next/link";
import { Edit, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPlanTime } from "@/lib/format-plan-time";
import { formatDecideBy } from "@/lib/format-decide-by";
import { isPastPlan } from "@/lib/effective-status";
import { FeaturedPlanVoters } from "./featured-plan-voters";
import { PlanVotes } from "@/components/votes/plan-votes";

export type FeaturedPlanData = {
  id: string;
  title: string;
  startsAt: Date;
  timeZone?: string;
  isApproximate: boolean;
  location: string | null;
  status: "active" | "confirmed" | "done" | "cancelled";
  decideBy: Date | null;
  // M21: when set, the plan has multi-venue voting in progress. We swap
  // `location` on the card for a leader hint or "N options" fallback.
  venueSummary?: {
    label: string | null;
    total: number;
    optionCount: number;
  } | null;
  creator?: {
    displayName: string;
    avatarUrl: string | null;
  } | null;
  // Latest plan_events.created_at (M24) for "last edit Nm ago".
  lastEditAt?: Date | null;
  // True if the viewer is allowed to edit the plan (creator or circle admin).
  canEdit?: boolean;
};

export function FeaturedPlanCard({
  plan,
  slug,
  now,
  // M25 — UA-aware Maps URL computed by the server. Null when there's no
  // canonical location to point at (yet).
  mapsUrl,
}: {
  plan: FeaturedPlanData;
  slug: string;
  now: Date;
  mapsUrl: string | null;
}) {
  const isConfirmed = plan.status === "confirmed";
  // Past plans never show vote UI / calendar / change-vote — see Fix 3 /
  // lib/effective-status.ts. The home circle query excludes startsAt<now
  // so this is defensive; if a plan slips past while the user is viewing
  // we still want clean degradation.
  const past = isPastPlan(plan, now);
  const isVoting =
    !isConfirmed &&
    !past &&
    !!plan.venueSummary &&
    plan.venueSummary.optionCount >= 2;
  const countdown =
    plan.decideBy && !isConfirmed && !past
      ? formatDecideBy(plan.decideBy, now)
      : null;

  const pillBase =
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]";
  // -strong text variants pass AA at 11px on the soft fills; the plain
  // tokens dip below 3:1 with the louder v2 palette.
  const pillStyle = isConfirmed
    ? "bg-in-soft text-in-strong"
    : isVoting
      ? "bg-coral-soft text-coral-strong"
      : "bg-coral-soft text-coral-strong";
  const pillLabel = isConfirmed ? "Locked" : isVoting ? "Voting" : "Deciding";

  const whenLabel = formatPlanTime(
    plan.startsAt,
    plan.isApproximate,
    now,
    plan.timeZone,
  );

  // M21 — leading venue overrides plain location when voting is in progress.
  const venueChip = plan.venueSummary
    ? plan.venueSummary.label
      ? {
          label: `${plan.venueSummary.label} · ${plan.venueSummary.total}`,
          muted: false,
        }
      : {
          label: `${plan.venueSummary.optionCount} options · voting`,
          muted: true,
        }
    : null;
  const whereValue = venueChip?.label ?? plan.location ?? "TBD";
  const whereMuted = venueChip ? venueChip.muted : !plan.location;

  // M25 — show Open in Maps when the plan has a real (non-voting) location
  // pinned. While venue voting is open we don't surface it because the
  // canonical address isn't decided yet. Past plans never show maps /
  // edit (no actionable destination).
  const showMaps = !past && mapsUrl && !venueChip;
  const showEdit = !past && (plan.canEdit ?? false);
  const showActionRow = showMaps || showEdit;

  const lastEditLabel = plan.lastEditAt
    ? formatLastEdit(plan.lastEditAt, now)
    : null;

  return (
    <div className="group relative flex flex-col gap-5 rounded-2xl border border-ink/5 bg-paper-card p-5 shadow-card-raised transition-shadow duration-150 focus-within:ring-2 focus-within:ring-coral">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn(pillBase, pillStyle)}>
          {isConfirmed ? (
            <span aria-hidden>✓</span>
          ) : (
            // The pulsing dot signals "live decision in progress" — quiet
            // animation, GPU-cheap, only when the plan isn't locked yet.
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-coral animate-pulse-soft"
            />
          )}
          {pillLabel}
        </span>
        {countdown ? (
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-coral-strong">
            · {countdown}
          </span>
        ) : null}
      </div>

      {/* Whole-title link instead of a stretched overlay so the inline
          vote buttons + action row stay easily clickable. The viewTransitionName
          morphs the title into the plan-detail h1 on tap (browser View
          Transitions API, enabled at the root layout). */}
      <Link
        href={`/c/${slug}/p/${plan.id}`}
        prefetch
        className="rounded-xl transition-transform duration-100 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
      >
        <h2
          className="font-serif text-2xl font-semibold leading-tight text-ink sm:text-3xl"
          style={{ viewTransitionName: `plan-title-${plan.id}` }}
        >
          {plan.title}
        </h2>
      </Link>

      {(plan.creator || lastEditLabel) ? (
        <div className="-mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
          {plan.creator ? (
            <span className="inline-flex items-center gap-1.5">
              {plan.creator.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={plan.creator.avatarUrl}
                  alt=""
                  className="size-4 rounded-full object-cover"
                />
              ) : null}
              <span>Started by {plan.creator.displayName}</span>
            </span>
          ) : null}
          {lastEditLabel ? (
            <span>· last edit {lastEditLabel}</span>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Chip label="When" value={whenLabel} />
        <Chip label="Where" value={whereValue} muted={whereMuted} />
      </div>

      <div>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
          Who&apos;s in
        </span>
        <div className="mt-2">
          <FeaturedPlanVoters planId={plan.id} />
        </div>
      </div>

      {/* Past plans never show vote UI — effectiveStatus check */}
      {!past ? (
        <div>
          <PlanVotes planId={plan.id} buttonSize="lg" showTally={false} />
        </div>
      ) : null}

      {showActionRow ? (
        <div className="flex flex-wrap gap-2">
          {showMaps ? (
            <a
              href={mapsUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-paper px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
            >
              <MapPin className="size-3.5" aria-hidden />
              Open in Maps
            </a>
          ) : null}
          {showEdit ? (
            <Link
              href={`/c/${slug}/p/${plan.id}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-paper px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
            >
              <Edit className="size-3.5" aria-hidden />
              Edit plan
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatLastEdit(d: Date, now: Date): string {
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return "just now";
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(diffMs / 86_400_000);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function Chip({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-paper px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        {label}
      </span>
      <span
        className={cn(
          "truncate text-sm font-medium",
          muted ? "text-ink-muted" : "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}
