"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";
import { GradientAvatar } from "@/components/ui/gradient-avatar";
import type { PlanType } from "@/lib/validation/plan";
import type { EffectiveStatus } from "@/lib/effective-status";
import { cn } from "@/lib/utils";

export type ThisWeekListPlan = {
  id: string;
  title: string;
  type: PlanType;
  startsAt: Date;
  timeZone: string;
  isApproximate: boolean;
  location: string | null;
  status: "active" | "confirmed" | "done" | "cancelled";
  effectiveStatus: EffectiveStatus;
  venueSummary?: {
    label: string | null;
    total: number;
    optionCount: number;
  } | null;
};

function shortDay(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz })
    .format(d)
    .toUpperCase();
}

function dayOfMonth(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: tz }).format(
    d,
  );
}

function shortTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  }).format(d);
}

export function ThisWeekList({
  plans,
  slug,
}: {
  plans: ThisWeekListPlan[];
  slug: string;
}) {
  if (plans.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Upcoming plans">
      {plans.map((p) => (
        <li key={p.id}>
          <ThisWeekRow plan={p} slug={slug} />
        </li>
      ))}
    </ul>
  );
}

function ThisWeekRow({
  plan,
  slug,
}: {
  plan: ThisWeekListPlan;
  slug: string;
}) {
  const dayLabel = plan.isApproximate ? "TBD" : shortDay(plan.startsAt, plan.timeZone);
  const dateLabel = plan.isApproximate ? "·" : dayOfMonth(plan.startsAt, plan.timeZone);
  const timeLabel = plan.isApproximate
    ? null
    : shortTime(plan.startsAt, plan.timeZone);
  const status = pickStatus(plan);
  const venue = plan.venueSummary?.label ?? plan.location;
  const isCancelled = plan.status === "cancelled";

  return (
    <Link
      href={`/c/${slug}/p/${plan.id}`}
      prefetch
      className={cn(
        "group flex items-center gap-3.5 rounded-2xl border border-ink/8 bg-paper-card px-3 py-2.5",
        "transition-colors hover:bg-paper-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral",
        isCancelled && "opacity-70",
      )}
    >
      {/* Date pill — left rail. SUNK surface keeps it visually distinct
          from the row card without needing a border. */}
      <div className="flex h-12 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-ink/[0.04]">
        <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
          {dayLabel}
        </span>
        <span className="mt-px text-[18px] font-bold leading-none tabular-nums text-ink">
          {dateLabel}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-semibold leading-tight tracking-tight text-ink">
          <span className={isCancelled ? "line-through" : undefined}>
            {plan.title}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-muted">
          {timeLabel ? <span>{timeLabel}</span> : null}
          {timeLabel && (venue || status) ? (
            <span aria-hidden className="size-[3px] rounded-full bg-ink-muted/60" />
          ) : null}
          <span
            className={cn(
              "truncate font-semibold",
              status.toneClass,
            )}
          >
            {status.label}
          </span>
        </div>
      </div>
      <AvatarCluster planId={plan.id} />
    </Link>
  );
}

function pickStatus(plan: ThisWeekListPlan): {
  label: string;
  toneClass: string;
} {
  if (plan.status === "cancelled") {
    return { label: "Cancelled", toneClass: "text-out" };
  }
  if (plan.status === "confirmed") {
    return { label: "Locked", toneClass: "text-in" };
  }
  if (plan.effectiveStatus === "lapsed") {
    return { label: "Lapsed", toneClass: "text-ink-muted" };
  }
  if (plan.venueSummary && plan.venueSummary.optionCount >= 2) {
    return {
      label: plan.venueSummary.label
        ? `${plan.venueSummary.total} voting`
        : `${plan.venueSummary.optionCount} options`,
      toneClass: "text-voting",
    };
  }
  return { label: "Deciding", toneClass: "text-coral" };
}

function AvatarCluster({ planId }: { planId: string }) {
  const { voters } = useCircleVotes();
  const stacked = useMemo(() => {
    const list = voters[planId] ?? [];
    const order = { in: 0, maybe: 1, out: 2 } as const;
    return [...list].sort((a, b) => order[a.status] - order[b.status]).slice(0, 3);
  }, [voters, planId]);

  if (stacked.length === 0) return null;

  return (
    <span className="flex shrink-0 -space-x-1.5">
      {stacked.map((v) => (
        <GradientAvatar
          key={v.userId}
          seed={v.userId}
          name={v.displayName}
          src={v.avatarUrl}
          size="xs"
          className="ring-2 ring-paper-card"
        />
      ))}
    </span>
  );
}
