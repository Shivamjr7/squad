import Link from "next/link";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPlanTime } from "@/lib/format-plan-time";
import { formatDecideBy } from "@/lib/format-decide-by";
import { FeaturedPlanVoters } from "./featured-plan-voters";

export type FeaturedPlanData = {
  id: string;
  title: string;
  startsAt: Date;
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
  const countdown =
    plan.decideBy && !isConfirmed ? formatDecideBy(plan.decideBy, now) : null;

  const pillBase =
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]";
  const pillStyle = isConfirmed
    ? "bg-in-soft text-in"
    : "bg-coral-soft text-coral";
  const dotColor = isConfirmed ? "bg-in" : "bg-coral";
  const pillLabel = isConfirmed ? "Confirmed" : "Deciding";

  const whenLabel = formatPlanTime(plan.startsAt, plan.isApproximate, now);

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
  const whereMuted = venueChip
    ? venueChip.muted
    : !plan.location;

  // M25 — show Open in Maps when the plan has a real (non-voting) location
  // pinned. While venue voting is open we don't surface it because the
  // canonical address isn't decided yet.
  const showMaps = mapsUrl && !venueChip;

  return (
    <div className="group relative flex touch-manipulation flex-col gap-5 rounded-2xl bg-paper-card p-5 shadow-[0_1px_2px_rgba(20,15,10,0.04),0_8px_24px_-12px_rgba(20,15,10,0.12)] transition-shadow duration-150 hover:shadow-[0_1px_2px_rgba(20,15,10,0.05),0_12px_32px_-12px_rgba(20,15,10,0.18)] focus-within:ring-2 focus-within:ring-coral">
      {/* Stretched-link overlay: the whole card is the plan-detail link via
          this absolute-fill anchor, which lets us nest other interactive
          elements (Open in Maps) without breaking HTML semantics. */}
      <Link
        href={`/c/${slug}/p/${plan.id}`}
        prefetch
        aria-label={plan.title}
        className="absolute inset-0 rounded-2xl focus-visible:outline-none"
      />

      <div className="relative flex flex-wrap items-center gap-2">
        <span className={cn(pillBase, pillStyle)}>
          {isConfirmed ? (
            <span aria-hidden>✓</span>
          ) : (
            <span aria-hidden className={cn("size-1.5 rounded-full", dotColor)} />
          )}
          {pillLabel}
        </span>
        {countdown ? (
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-coral">
            · {countdown}
          </span>
        ) : null}
      </div>

      <h2 className="relative font-serif text-2xl font-semibold leading-tight text-ink sm:text-3xl">
        {plan.title}
      </h2>

      <div className="relative grid grid-cols-2 gap-2">
        <Chip label="When" value={whenLabel} />
        <Chip label="Where" value={whereValue} muted={whereMuted} />
      </div>

      {showMaps ? (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="relative inline-flex w-fit items-center gap-1.5 rounded-full border border-ink/15 bg-paper px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
        >
          <MapPin className="size-3.5" aria-hidden />
          Open in Maps
        </a>
      ) : null}

      <div className="relative">
        <FeaturedPlanVoters planId={plan.id} />
      </div>
    </div>
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
