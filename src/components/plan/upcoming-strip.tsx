"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { PlanType } from "@/lib/validation/plan";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";

// All three formatters take the plan's IANA zone (plans.time_zone) so the
// strip renders the day / date / hour the creator picked. Module-level
// caching isn't safe here because the zone changes per plan — call them
// fresh per render.
function dayLabel(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(d);
}
function dateLabel(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(d);
}
function timeLabel(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(d);
}

const TYPE_BAR: Record<PlanType, string> = {
  eat: "bg-[#4CAF50]",
  play: "bg-[#2196F3]",
  chai: "bg-[#FF9800]",
  "stay-in": "bg-[#9E9E9E]",
  other: "bg-[#9E9E9E]",
};

export type UpcomingStripPlan = {
  id: string;
  title: string;
  type: PlanType;
  startsAt: Date;
  // Required — see PlanCardData / format-plan-time.ts.
  timeZone: string;
  isApproximate: boolean;
  location: string | null;
  status: "active" | "confirmed" | "done" | "cancelled";
  venueSummary?: {
    label: string | null;
    total: number;
    optionCount: number;
  } | null;
};

export function UpcomingStrip({
  plans,
  slug,
}: {
  plans: UpcomingStripPlan[];
  slug: string;
}) {
  return (
    <ul
      className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0"
      aria-label="Upcoming plans"
    >
      {plans.map((plan) => (
        <li
          key={plan.id}
          className="snap-start"
        >
          <UpcomingCard plan={plan} slug={slug} />
        </li>
      ))}
    </ul>
  );
}

function UpcomingCard({
  plan,
  slug,
}: {
  plan: UpcomingStripPlan;
  slug: string;
}) {
  const dayText = plan.isApproximate
    ? "TBD"
    : dayLabel(plan.startsAt, plan.timeZone).toUpperCase();
  const dateText = plan.isApproximate
    ? ""
    : dateLabel(plan.startsAt, plan.timeZone).toUpperCase();
  const timeText = plan.isApproximate
    ? ""
    : timeLabel(plan.startsAt, plan.timeZone);

  const venueLabel = plan.venueSummary
    ? plan.venueSummary.label
      ? plan.venueSummary.label
      : `${plan.venueSummary.optionCount} options`
    : plan.location;

  const status = pickStatus(plan);

  return (
    <Link
      href={`/c/${slug}/p/${plan.id}`}
      prefetch
      className="group flex w-[230px] touch-manipulation flex-col gap-3 rounded-2xl bg-paper-card p-4 shadow-sm transition-shadow duration-150 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
          <span
            aria-hidden
            className={cn("size-1.5 rounded-full", TYPE_BAR[plan.type])}
          />
          <span>{dayText}</span>
          {dateText ? <span>· {dateText}</span> : null}
        </span>
        <StatusBadge tone={status.tone} label={status.label} />
      </div>
      <h3 className="font-serif text-lg font-semibold leading-tight text-ink line-clamp-2">
        {plan.title}
      </h3>
      <div className="flex flex-col gap-0.5 text-xs text-ink-muted">
        {timeText ? <span>{timeText}</span> : null}
        {venueLabel ? (
          <span className="truncate">{venueLabel}</span>
        ) : null}
      </div>
      <AvatarCluster planId={plan.id} />
    </Link>
  );
}

function pickStatus(
  plan: UpcomingStripPlan,
): { tone: "in" | "coral" | "muted"; label: string } {
  if (plan.status === "confirmed") return { tone: "in", label: "Locked" };
  if (plan.venueSummary && plan.venueSummary.optionCount >= 2) {
    return { tone: "coral", label: "Voting" };
  }
  return { tone: "muted", label: "Deciding" };
}

function StatusBadge({
  tone,
  label,
}: {
  tone: "in" | "coral" | "muted";
  label: string;
}) {
  const className =
    tone === "in"
      ? "bg-in-soft text-in"
      : tone === "coral"
        ? "bg-coral-soft text-coral"
        : "bg-paper text-ink-muted";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
        className,
      )}
    >
      {label}
    </span>
  );
}

function AvatarCluster({ planId }: { planId: string }) {
  const { voters } = useCircleVotes();
  const list = voters[planId] ?? [];
  if (list.length === 0) {
    return <span className="text-xs text-ink-muted">No votes yet</span>;
  }
  // Sort: in first, then maybe, then out.
  const ranked = [...list].sort((a, b) => {
    const order = { in: 0, maybe: 1, out: 2 } as const;
    return order[a.status] - order[b.status];
  });
  const stack = ranked.slice(0, 4);
  const remainder = list.length - stack.length;
  return (
    <div className="flex items-center gap-2">
      <span className="flex -space-x-1.5">
        {stack.map((v) => (
          <Avatar
            key={v.userId}
            displayName={v.displayName}
            avatarUrl={v.avatarUrl}
            ring={v.status}
          />
        ))}
      </span>
      {remainder > 0 ? (
        <span className="text-xs text-ink-muted">+{remainder}</span>
      ) : null}
    </div>
  );
}

function Avatar({
  displayName,
  avatarUrl,
  ring,
}: {
  displayName: string;
  avatarUrl: string | null;
  ring: "in" | "maybe" | "out";
}) {
  const ringClass = cn(
    "ring-2 ring-paper-card",
    ring === "in" && "outline outline-2 outline-in/30",
    ring === "maybe" && "outline outline-2 outline-maybe/40",
    ring === "out" && "outline outline-2 outline-out/30",
  );
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        className={cn("size-6 rounded-full object-cover", ringClass)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium uppercase",
        ringClass,
      )}
    >
      {displayName.slice(0, 1)}
    </span>
  );
}
