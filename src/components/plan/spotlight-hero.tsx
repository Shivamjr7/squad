"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Check, Clock, MessageCircle, Sparkles } from "lucide-react";
import { castVote } from "@/lib/actions/votes";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";
import type { VoteStatus } from "@/lib/validation/vote";
import { GradientAvatar } from "@/components/ui/gradient-avatar";
import { cn } from "@/lib/utils";

// Spotlight hero — the home page's featured "tonight's plan" card.
// Built on semantic tokens (`bg-paper-card`, `text-ink`, brand vars) so
// the surface self-flips between light and dark themes without parallel
// palettes. Same approach as the plan-detail LiveDashboard cockpit.

export type SpotlightHeroPlan = {
  id: string;
  title: string;
  startsAt: Date;
  timeZone: string;
  isApproximate: boolean;
  location: string | null;
  status: "active" | "confirmed" | "done" | "cancelled";
  decideBy: Date | null;
  creator: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  venueSummary?: {
    label: string | null;
    total: number;
    optionCount: number;
  } | null;
};

type Props = {
  plan: SpotlightHeroPlan;
  circleName: string;
  slug: string;
  now: Date;
};

function isSameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  });
  return fmt.format(a) === fmt.format(b);
}

function whenWord(startsAt: Date, now: Date, timeZone: string): string {
  if (isSameLocalDay(startsAt, now, timeZone)) return "Tonight";
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (isSameLocalDay(startsAt, tomorrow, timeZone)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone,
  })
    .format(startsAt)
    .toUpperCase();
}

function formatHourMinute(d: Date, tz: string): { hour: string; suffix: string } {
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  const dayPart = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  return {
    hour: `${hour}:${minute}`,
    suffix: dayPart.toUpperCase(),
  };
}

export function SpotlightHero({ plan, circleName, slug, now: serverNow }: Props) {
  const {
    voters,
    currentUser,
    setOptimisticVote,
    clearOptimisticVote,
  } = useCircleVotes();
  const planVoters = useMemo(
    () => voters[plan.id] ?? [],
    [voters, plan.id],
  );
  const displayVoters = useMemo(() => {
    if (!plan.creator) return planVoters;
    if (planVoters.some((v) => v.userId === plan.creator!.id)) {
      return planVoters;
    }
    return [
      ...planVoters,
      {
        userId: plan.creator.id,
        displayName: plan.creator.displayName,
        avatarUrl: plan.creator.avatarUrl,
        status: "in" as VoteStatus,
        votedAt: plan.startsAt.toISOString(),
      },
    ];
  }, [plan.creator, plan.startsAt, planVoters]);

  const counts = useMemo(() => {
    let inN = 0;
    let maybeN = 0;
    let outN = 0;
    for (const v of displayVoters) {
      if (v.status === "in") inN += 1;
      else if (v.status === "maybe") maybeN += 1;
      else outN += 1;
    }
    return { in: inN, maybe: maybeN, out: outN };
  }, [displayVoters]);

  // Surface IN voters first in the avatar stack — they're the people who
  // matter most for the at-a-glance count.
  const stackedVoters = useMemo(() => {
    const order: Record<VoteStatus, number> = { in: 0, maybe: 1, out: 2 };
    return [...displayVoters]
      .sort((a, b) => order[a.status] - order[b.status])
      .slice(0, 4);
  }, [displayVoters]);

  const effectiveVote =
    displayVoters.find((v) => v.userId === currentUser.id)?.status ?? null;

  const onVote = (next: VoteStatus) => {
    setOptimisticVote(plan.id, next);
    void (async () => {
      try {
        await castVote({ planId: plan.id, status: next });
      } catch (err) {
        clearOptimisticVote(plan.id);
        toast.error(
          err instanceof Error ? err.message : "Couldn't save vote.",
        );
      }
    })();
  };

  // Tick once a minute by default — only switch to per-second ticks when
  // we're inside the final hour, otherwise a 20h-out countdown burns one
  // re-render per second for no perceptible change.
  const [tick, setTick] = useState(0);
  const insideLastHour = useMemo(() => {
    if (!plan.decideBy) return false;
    if (plan.status === "confirmed") return false;
    const ms = plan.decideBy.getTime() - serverNow.getTime();
    return ms > 0 && ms <= 60 * 60 * 1000;
  }, [plan.decideBy, plan.status, serverNow]);
  useEffect(() => {
    if (!plan.decideBy) return;
    if (plan.status === "confirmed") return;
    const intervalMs = insideLastHour ? 1000 : 60_000;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [plan.decideBy, plan.status, insideLastHour]);

  // Three resolutions, no live HH:MM:SS for far-out plans:
  //   • > 24h    → "Locks <weekday> <h>:<mm><a/p>"
  //   • 1h–24h   → "in 3h" / "in 47m"
  //   • < 1h     → "MM:SS" (tick-tick to convey urgency)
  // Pre-radiate the radial dot animation already encodes "live" so the
  // countdown itself doesn't need to scream — copy carries the meaning.
  const countdown = useMemo(() => {
    if (!plan.decideBy) return null;
    if (plan.status === "confirmed") return null;
    const tickInterval = insideLastHour ? 1000 : 60_000;
    const ms =
      plan.decideBy.getTime() - (serverNow.getTime() + tick * tickInterval);
    if (ms <= 0) return null;
    const totalSec = Math.floor(ms / 1000);
    const totalMin = Math.floor(totalSec / 60);
    const totalHr = Math.floor(totalMin / 60);
    if (totalHr >= 24) {
      const parts = new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: plan.timeZone,
      }).formatToParts(plan.decideBy);
      const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
      const hr = parts.find((p) => p.type === "hour")?.value ?? "";
      const mn = parts.find((p) => p.type === "minute")?.value ?? "";
      const ap =
        parts.find((p) => p.type === "dayPeriod")?.value.toLowerCase() ?? "";
      return `Locks ${wd} ${hr}:${mn}${ap}`;
    }
    if (totalHr >= 1) {
      return `in ${totalHr}h`;
    }
    if (totalMin >= 1 && !insideLastHour) {
      return `in ${totalMin}m`;
    }
    const m = Math.floor(totalSec / 60);
    const s = totalSec - m * 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [plan.decideBy, plan.status, plan.timeZone, serverNow, tick, insideLastHour]);

  const isConfirmed = plan.status === "confirmed";
  const venueLeader = plan.venueSummary?.label ?? null;
  const isVoting =
    !isConfirmed &&
    !!plan.venueSummary &&
    plan.venueSummary.optionCount >= 2;

  const whenEyebrow = whenWord(plan.startsAt, serverNow, plan.timeZone);
  const time = plan.isApproximate
    ? null
    : formatHourMinute(plan.startsAt, plan.timeZone);
  const whereLabel = plan.location ?? (isVoting ? `${plan.venueSummary!.optionCount} options` : "TBD");
  const venueSubtitle = venueLeader ?? plan.location;

  return (
    <article
      className="relative overflow-hidden rounded-[26px] border border-ink/10 bg-paper-card text-ink shadow-[0_20px_55px_-34px_rgba(12,12,12,0.42)] dark:border-white/10 dark:bg-paper-elevated"
      data-testid="spotlight-hero"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-in/12 blur-[85px] dark:bg-white/[0.055]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_0%,rgba(255,255,255,0.88),transparent_34%),linear-gradient(145deg,rgba(255,255,255,0.50),rgba(48,128,93,0.07))] dark:bg-[linear-gradient(145deg,rgba(255,255,255,0.08),rgba(255,255,255,0.025))]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/70 dark:bg-white/12"
      />

      <div className="relative flex flex-col gap-3 p-4 sm:p-5">
        {/* Status pill + countdown — single row of meta. Pills use the
            *-soft / *-strong semantic pairs that already flip with
            theme: muted tint in light, brighter on dark. */}
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
              isConfirmed
                ? "border-in/30 bg-in-soft text-in-strong"
                : isVoting
                  ? "border-voting/30 bg-voting-soft text-voting-strong"
                  : "border-coral/30 bg-coral-soft text-coral-strong",
            )}
          >
            {isConfirmed ? (
              <span aria-hidden>✓</span>
            ) : (
              <span
                aria-hidden
                className={cn(
                  // Radiating halo — `animate-pulse-radiate` ripples a
                  // currentColor box-shadow outward so the dot reads as a
                  // live recording-now indicator. Solid bg-coral fill stays
                  // visible at the center while the halo expands and fades.
                  "size-1.5 animate-pulse-radiate rounded-full",
                  isVoting ? "bg-voting" : "bg-coral",
                )}
              />
            )}
            {isConfirmed ? "Locked" : isVoting ? "Voting" : "Deciding"}
          </span>
          {countdown ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.06] px-2.5 py-1.5 text-[12px] font-semibold tabular-nums text-ink ring-1 ring-ink/8 dark:bg-white/8 dark:ring-white/10">
              <Clock className="size-3.5 text-ink-muted" aria-hidden />
              {countdown}
            </span>
          ) : null}
        </div>

        {/* Eyebrow + title + italic serif venue. Tapping anywhere in this
            cluster takes you to plan detail; the vote controls below have
            their own stopPropagation via being explicit elements. */}
        <Link
          href={`/c/${slug}/p/${plan.id}`}
          prefetch
          className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper-card"
        >
          <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
            {circleName} · {whenEyebrow}
          </span>
          <h2
            className="mt-1.5 text-[30px] font-bold leading-[0.96] tracking-tight text-ink sm:text-[34px]"
            style={{ viewTransitionName: `plan-title-${plan.id}` }}
          >
            {plan.title}
          </h2>
          {venueSubtitle ? (
            <p className="mt-1.5 max-w-full truncate font-serif text-[18px] italic leading-snug text-coral sm:text-[20px]">
              at {venueSubtitle}
            </p>
          ) : null}
        </Link>

        <div className="grid grid-cols-2 gap-2">
          <div className="min-w-0 rounded-2xl border border-ink/8 bg-paper/70 px-3 py-2.5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/[0.045]">
            <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
              When
            </span>
            {time ? (
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-[20px] font-bold tabular-nums text-ink">
                  {time.hour}
                </span>
                <span className="text-[11px] font-semibold text-ink-muted">
                  {time.suffix}
                </span>
              </div>
            ) : (
              <span className="mt-1 block text-[14px] font-semibold text-ink">
                TBD
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-col rounded-2xl border border-ink/8 bg-paper/70 px-3 py-2.5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/[0.045]">
            <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
              Where
            </span>
            <span
              className={cn(
                "mt-1 truncate text-[15px] font-semibold",
                plan.location ? "text-ink" : "text-ink-muted",
              )}
            >
              {whereLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl border border-ink/8 bg-paper/75 px-3 py-2.5 shadow-sm dark:border-white/10 dark:bg-white/[0.045]">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex -space-x-1.5">
              {stackedVoters.length > 0 ? (
                stackedVoters.map((v) => (
                  <GradientAvatar
                    key={v.userId}
                    seed={v.userId}
                    name={v.displayName}
                    src={v.avatarUrl}
                    size="sm"
                    className="ring-2 ring-paper-card"
                  />
                ))
              ) : (
                <span
                  className="size-6 rounded-full bg-ink/10 ring-2 ring-paper-card"
                  aria-hidden
                />
              )}
            </span>
            <div className="min-w-0 text-[12.5px] leading-tight">
              {planVoters.length === 0 ? (
                <span className="text-ink-muted">Be first to vote.</span>
              ) : (
                <>
                  <span className="font-bold text-ink">
                    {counts.in}{" "}
                    <span className="font-medium text-ink-muted">in</span>
                    {counts.maybe > 0 ? (
                      <>
                        {" · "}
                        <span className="text-[color:var(--maybe-strong)]">
                          {counts.maybe}
                        </span>{" "}
                        <span className="font-medium text-ink-muted">maybe</span>
                      </>
                    ) : null}
                  </span>
                  {effectiveVote === null ? (
                    <span className="mt-0.5 block text-[11px] text-ink-muted">
                      Your RSVP is waiting
                    </span>
                  ) : null}
                </>
              )}
            </div>
          </div>
          {effectiveVote === "in" ? (
            <span className="shrink-0 rounded-full bg-in-soft px-2.5 py-1 text-[11px] font-bold text-in-strong">
              Joined
            </span>
          ) : null}
        </div>

        {/* Dominant CTA. Dark mode uses a neutral glass treatment so the
            action stays prominent without turning neon on a black surface. */}
        <button
          type="button"
          onClick={() => onVote("in")}
          disabled={effectiveVote === "in"}
          aria-pressed={effectiveVote === "in"}
          className={cn(
            "group relative flex h-12 w-full items-center justify-center overflow-hidden rounded-2xl px-4 text-[15px] font-bold tracking-tight text-paper transition duration-200",
            "border border-in/20 bg-in shadow-[0_16px_34px_-22px_oklch(0.60_0.20_148/0.62)]",
            "dark:border-white/12 dark:bg-white/[0.105] dark:text-ink dark:shadow-[0_16px_30px_-22px_rgba(0,0,0,0.75)] dark:ring-1 dark:ring-white/[0.055]",
            "hover:-translate-y-0.5 hover:bg-in/95 hover:shadow-[0_20px_42px_-22px_oklch(0.60_0.20_148/0.70)]",
            "dark:hover:bg-white/[0.14] dark:hover:shadow-[0_20px_42px_-24px_rgba(0,0,0,0.85)]",
            "active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-in dark:focus-visible:outline-coral",
            effectiveVote === "in" &&
              "cursor-default border-in/25 bg-in-soft text-in-strong hover:translate-y-0 hover:bg-in-soft dark:border-white/12 dark:bg-white/[0.12] dark:text-ink dark:hover:bg-white/[0.12]",
          )}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 rotate-12 bg-white/20 blur-md transition-transform duration-700 group-hover:translate-x-[420%] dark:bg-white/10"
          />
          {effectiveVote === "in" ? (
            <span className="relative flex items-center gap-2">
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-in text-paper dark:bg-coral dark:text-paper">
                <Check className="size-4" strokeWidth={2.8} aria-hidden />
              </span>
              You&rsquo;re in
            </span>
          ) : (
            <span className="relative flex w-full items-center justify-between gap-3">
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-paper/16 text-paper ring-1 ring-paper/20 dark:bg-coral-soft dark:text-coral-strong dark:ring-coral/20">
                <Sparkles className="size-4" strokeWidth={2.4} aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col items-center leading-tight">
                <span>I&rsquo;m in</span>
                <span className="mt-0.5 text-[10.5px] font-semibold text-paper/72 dark:text-ink-muted">
                  Join {counts.in > 0 ? `${counts.in} already in` : "the plan"}
                </span>
              </span>
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-paper text-in-strong transition-transform group-hover:translate-x-0.5 dark:bg-coral dark:text-paper">
                <ArrowRight className="size-4" strokeWidth={2.6} aria-hidden />
              </span>
            </span>
          )}
        </button>

        {/* Secondary row — Maybe / Can't / Chat. ink/* utilities flip via
            the semantic token so the row reads on both surfaces. */}
        <div className="flex gap-1.5">
          <SecondaryButton
            label="Maybe"
            active={effectiveVote === "maybe"}
            onClick={() => onVote("maybe")}
          />
          <SecondaryButton
            label="Can't"
            active={effectiveVote === "out"}
            onClick={() => onVote("out")}
          />
          <Link
            href={`/c/${slug}/p/${plan.id}#comments`}
            className={cn(
              "inline-flex h-9 flex-[1.2] items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold text-ink",
              "bg-ink/[0.05] hover:bg-ink/[0.10] transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral",
            )}
          >
            <MessageCircle className="size-3.5" aria-hidden />
            Chat
          </Link>
        </div>
      </div>
    </article>
  );
}

function SecondaryButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 flex-1 items-center justify-center rounded-xl text-[13px] font-semibold transition-colors text-ink",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral",
        active
          ? "bg-ink/[0.18]"
          : "bg-ink/[0.05] hover:bg-ink/[0.10]",
      )}
    >
      {label}
    </button>
  );
}
