import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatPlanTime } from "@/lib/format-plan-time";
import { formatDecideBy } from "@/lib/format-decide-by";
import { isPastPlan } from "@/lib/effective-status";
import { circleDotClass } from "@/lib/circle-color";
import { FeaturedPlanVoters } from "./featured-plan-voters";
import { Pill, type PillTone } from "@/components/ui/pill";

export type FeaturedPlanData = {
  id: string;
  title: string;
  startsAt: Date;
  // Required — see PlanCardData / format-plan-time.ts.
  timeZone: string;
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
  // UI Phase 7 — optional one-word vibe; rendered as a chip next to the
  // status pill when present.
  vibe?: string | null;
};

export function FeaturedPlanCard({
  plan,
  slug,
  now,
  circleId,
}: {
  plan: FeaturedPlanData;
  slug: string;
  now: Date;
  // Drives the left-edge circle-identity ribbon. Optional for back-compat
  // with any caller not yet passing it (renders without the ribbon then).
  circleId?: string;
  // Accepted for back-compat with existing callers; the M31 redesign
  // moved the "Open in Maps" affordance off the home card and onto the
  // plan-detail surface, so the prop is intentionally ignored here.
  mapsUrl?: string | null;
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

  // -strong text variants pass AA at 11px on the soft fills; the plain
  // tokens dip below 3:1 with the louder v2 palette. Voting (multi-venue)
  // gets its own cool-violet tone so it visually distinguishes from coral
  // "deciding when".
  const pillTone: PillTone = isConfirmed
    ? "in"
    : isVoting
      ? "voting"
      : "coral";
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

  return (
    <Link
      href={`/c/${slug}/p/${plan.id}`}
      prefetch
      className="group relative flex flex-col gap-3.5 overflow-hidden rounded-[18px] border border-ink/10 bg-paper-card p-4 pl-5 shadow-card transition-shadow duration-150 hover:shadow-card-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
    >
      {circleId ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-0 bottom-0 left-0 w-1",
            past ? "bg-ink-subtle" : circleDotClass(circleId),
          )}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Pill
          tone={pillTone}
          size="md"
          leading={
            isConfirmed ? (
              <span aria-hidden>✓</span>
            ) : (
              // The pulsing dot signals "live decision in progress" — quiet
              // animation, GPU-cheap, only when the plan isn't locked yet.
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full animate-pulse-soft",
                  isVoting ? "bg-voting" : "bg-coral",
                )}
              />
            )
          }
        >
          {pillLabel}
        </Pill>
        {plan.vibe ? (
          <Pill tone="ink" size="md" variant="outline">
            {plan.vibe}
          </Pill>
        ) : null}
        {countdown ? (
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-coral-strong">
            · {countdown}
          </span>
        ) : null}
      </div>

      <h2
        className="font-serif text-xl font-semibold leading-tight text-ink sm:text-2xl"
        style={{ viewTransitionName: `plan-title-${plan.id}` }}
      >
        {plan.title}
      </h2>

      <div className="grid grid-cols-2 gap-2">
        <Chip label="When" value={whenLabel} />
        <Chip label="Where" value={whereValue} muted={whereMuted} />
      </div>

      {!past ? (
        <FeaturedPlanVoters planId={plan.id} />
      ) : null}
    </Link>
  );
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
  // Chip surface is a low-alpha ink tint so it sits *on* the white card
  // without picking up the body gradient (bg-paper would read pink-ish
  // here because the body radial bleeds through the card's transparency
  // edges). Hairline border replaces fill for definition.
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-ink/8 bg-ink/[0.025] px-2.5 py-1.5">
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
