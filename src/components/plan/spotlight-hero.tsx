"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Check, Clock, MessageCircle } from "lucide-react";
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
  const { voters, currentUser } = useCircleVotes();
  const planVoters = useMemo(
    () => voters[plan.id] ?? [],
    [voters, plan.id],
  );

  const counts = useMemo(() => {
    let inN = 0;
    let maybeN = 0;
    let outN = 0;
    for (const v of planVoters) {
      if (v.status === "in") inN += 1;
      else if (v.status === "maybe") maybeN += 1;
      else outN += 1;
    }
    return { in: inN, maybe: maybeN, out: outN };
  }, [planVoters]);

  // Surface IN voters first in the avatar stack — they're the people who
  // matter most for the at-a-glance count.
  const stackedVoters = useMemo(() => {
    const order: Record<VoteStatus, number> = { in: 0, maybe: 1, out: 2 };
    return [...planVoters]
      .sort((a, b) => order[a.status] - order[b.status])
      .slice(0, 4);
  }, [planVoters]);

  const canonicalVote =
    planVoters.find((v) => v.userId === currentUser.id)?.status ?? null;

  const [pendingVote, setPendingVote] = useState<VoteStatus | undefined>(
    undefined,
  );

  // Clear the optimistic override once the realtime row arrives matching
  // what we set — mirrors live-ticker's pattern.
  useEffect(() => {
    if (pendingVote === undefined) return;
    if (canonicalVote === pendingVote) setPendingVote(undefined);
  }, [canonicalVote, pendingVote]);

  const effectiveVote: VoteStatus | null =
    pendingVote !== undefined ? pendingVote : canonicalVote;

  const onVote = (next: VoteStatus) => {
    setPendingVote(next);
    void (async () => {
      try {
        await castVote({ planId: plan.id, status: next });
      } catch (err) {
        setPendingVote(undefined);
        toast.error(
          err instanceof Error ? err.message : "Couldn't save vote.",
        );
      }
    })();
  };

  // Tick every second for the countdown — only mounts the interval when
  // there's actually a decideBy to count down to.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!plan.decideBy) return;
    if (plan.status === "confirmed") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [plan.decideBy, plan.status]);

  const countdown = useMemo(() => {
    if (!plan.decideBy) return null;
    if (plan.status === "confirmed") return null;
    const ms =
      plan.decideBy.getTime() - (serverNow.getTime() + tick * 1000);
    if (ms <= 0) return null;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec - h * 3600) / 60);
    const s = totalSec - h * 3600 - m * 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [plan.decideBy, plan.status, serverNow, tick]);

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
      // Force dark surface regardless of app theme — the spotlight is
      // designed as a feature card that should always read as a dark hero
      // (mirrors the plan-detail cockpit). The semantic tokens defined
      // under [data-theme="dark"] cascade from here, and `dark:` utilities
      // inside the subtree activate via the custom Tailwind variant in
      // globals.css.
      data-theme="dark"
      className="relative overflow-hidden rounded-[28px] bg-paper-card text-ink shadow-card-hero"
      data-testid="spotlight-hero"
    >
      {/* Soft warm glow upper-right — coral token flips its own lightness
          for theme. Kept low-opacity in both modes: too much saturation
          on the dark surface reads as a maroon stain rather than warmth.
          Wider blur + larger radius spreads the light so no single edge
          dominates the card. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-32 size-[420px] rounded-full bg-coral/12 blur-[110px] dark:bg-coral/14"
      />

      <div className="relative flex flex-col gap-4 p-5 sm:p-6 lg:gap-5 lg:p-7">
        {/* Status pill + countdown — single row of meta. Pills use the
            *-soft / *-strong semantic pairs that already flip with
            theme: muted tint in light, brighter on dark. */}
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]",
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
                  "size-1.5 animate-pulse-soft rounded-full",
                  isVoting ? "bg-voting" : "bg-coral",
                )}
              />
            )}
            {isConfirmed ? "Locked" : isVoting ? "Voting" : "Deciding"}
          </span>
          {countdown ? (
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold tabular-nums text-ink">
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
          className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper-card"
        >
          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
            {circleName} · {whenEyebrow}
          </span>
          <h2
            className="mt-2 text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-[32px] lg:text-[34px]"
            style={{ viewTransitionName: `plan-title-${plan.id}` }}
          >
            {plan.title}
          </h2>
          {venueSubtitle ? (
            <p className="mt-1 font-serif text-[19px] italic leading-snug text-coral sm:text-[21px] lg:text-[23px]">
              at {venueSubtitle}
            </p>
          ) : null}
        </Link>

        {/* When / Where 2-cell grid. The 1px gap on an ink/8 backdrop
            paints as a hairline divider that flips with theme. */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-ink/8">
          <div className="bg-ink/[0.025] px-3.5 py-3">
            <span className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
              When
            </span>
            {time ? (
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="text-[19px] font-bold tabular-nums text-ink">
                  {time.hour}
                </span>
                <span className="text-[11px] font-semibold text-ink-muted">
                  {time.suffix}
                </span>
              </div>
            ) : (
              <span className="mt-1.5 block text-[15px] font-semibold text-ink">
                TBD
              </span>
            )}
          </div>
          <div className="flex flex-col bg-ink/[0.025] px-3.5 py-3">
            <span className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
              Where
            </span>
            <span
              className={cn(
                "mt-1.5 truncate text-[15px] font-semibold",
                plan.location ? "text-ink" : "text-ink-muted",
              )}
            >
              {whereLabel}
            </span>
          </div>
        </div>

        {/* Voter stack + tally. Falls back to "Be first to vote" when the
            row is empty so the rail never collapses. */}
        <div className="flex items-center gap-3">
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
          <div className="min-w-0 flex-1 text-[13px] leading-tight">
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
                    You haven&rsquo;t said yet
                  </span>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* Dominant CTA. Coral fills are the same hue both themes (the
            token flips lightness slightly). White text on coral reads at
            AA in both. Disabled-when-IN turns into quiet confirmation —
            the icon swaps from arrow (suggests action) to check (signals
            done) so the locked state doesn't read as a swipe target. */}
        <button
          type="button"
          onClick={() => onVote("in")}
          disabled={effectiveVote === "in"}
          aria-pressed={effectiveVote === "in"}
          className={cn(
            "flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold tracking-tight text-white transition-shadow",
            "bg-coral shadow-[0_10px_24px_-6px_oklch(0.62_0.16_18/0.45)]",
            "hover:shadow-[0_14px_28px_-6px_oklch(0.62_0.16_18/0.55)]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral",
            effectiveVote === "in" && "cursor-default opacity-90",
          )}
        >
          {effectiveVote === "in" ? (
            <>
              <Check className="size-4" strokeWidth={2.6} aria-hidden />
              You&rsquo;re in
            </>
          ) : (
            <>
              I&rsquo;m in
              <ArrowRight className="size-4" strokeWidth={2.4} aria-hidden />
            </>
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
            href={`/c/${slug}/p/${plan.id}#discussion`}
            className={cn(
              "inline-flex h-10 flex-[1.2] items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold text-ink",
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
        "inline-flex h-10 flex-1 items-center justify-center rounded-xl text-[13px] font-semibold transition-colors text-ink",
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
