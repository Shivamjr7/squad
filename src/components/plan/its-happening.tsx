"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarPlus, MapPin, MessageCircle } from "lucide-react";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";
import { castVote } from "@/lib/actions/votes";
import type { VoteConflict } from "@/lib/actions/conflicts";
import { cn } from "@/lib/utils";

// M31.8 — "It's happening" post-lock surface. Replaces M24 plan-detail
// variant C for `status = 'confirmed'`. Mirrors the locked-state screenshot
// from NOTIFICATIONS_PLAN.md §6: a green locked pill, a serif headline, a
// dark coral "Tonight" card with time + venue + add-on, a squad strip with
// IN voter avatars + calendar chip + OUT counter, and Directions + Squad
// chat actions. Done plans keep the M24 receipt skin — this surface is
// scoped to the live "we just locked, here's what's up" moment.

type LockTrigger = "threshold" | "forced" | "all_voted" | null;

export type ItsHappeningAddition = {
  id: string;
  label: string | null;
  startsAt: string;
};

type Props = {
  planId: string;
  startsAt: Date;
  timeZone?: string;
  location: string | null;
  recipientCount: number;
  inCount: number;
  lockedAtIso: string | null;
  lockTrigger: LockTrigger;
  additions: ItsHappeningAddition[];
  // Pre-built deep links. `commentsHref` anchors to the discussion section on
  // the same page so the Squad chat button is a same-page jump rather than a
  // navigation.
  mapsUrl: string | null;
  icsUrl: string | null;
  commentsHref: string;
  // M32.8 §4.4 — the viewer's other commitment that overlaps this locked
  // time. Null when there's no conflict (the common case) or when the
  // viewer isn't themselves IN on the locked plan (server gates this).
  conflict?: VoteConflict | null;
};

const HEADLINE_DATE = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
});

function isSameLocalDay(a: Date, b: Date, timeZone?: string): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  });
  return fmt.format(a) === fmt.format(b);
}

function dayLabel(startsAt: Date, timeZone?: string): string {
  const now = new Date();
  if (isSameLocalDay(startsAt, now, timeZone)) return "Tonight";
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (isSameLocalDay(startsAt, tomorrow, timeZone)) return "Tomorrow";
  return HEADLINE_DATE.format(startsAt);
}

function formatShortTime(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

function formatLockTime(iso: string | null, timeZone?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatShortTime(d, timeZone);
}

function reasonLine(
  trigger: LockTrigger,
  inCount: number,
  recipientCount: number,
): string {
  const tally = `${inCount} of ${recipientCount} ${inCount === 1 ? "is" : "are"} in`;
  switch (trigger) {
    case "threshold":
      return `${tally}. Plan auto-locked when consensus hit.`;
    case "all_voted":
      return `${tally}. Plan auto-locked once everyone voted.`;
    case "forced":
      return `${tally}. Plan auto-locked at the deadline.`;
    default:
      return `${tally}.`;
  }
}

export function ItsHappening({
  planId,
  startsAt,
  timeZone,
  location,
  recipientCount,
  inCount: seedInCount,
  lockedAtIso,
  lockTrigger,
  additions,
  mapsUrl,
  icsUrl,
  commentsHref,
  conflict,
}: Props) {
  const { voters } = useCircleVotes();
  const planVoters = useMemo(
    () => voters[planId] ?? [],
    [voters, planId],
  );

  // Vote counts are live — someone can still flip to OUT after lock. The
  // server-rendered seed gets us through first paint; subsequent realtime
  // updates flow through useCircleVotes.
  const { liveInCount, outCount, inVoters } = useMemo(() => {
    if (planVoters.length === 0) {
      return { liveInCount: seedInCount, outCount: 0, inVoters: [] };
    }
    let inN = 0;
    let outN = 0;
    const ins = [] as typeof planVoters;
    for (const v of planVoters) {
      if (v.status === "in") {
        inN += 1;
        ins.push(v);
      } else if (v.status === "out") {
        outN += 1;
      }
    }
    return { liveInCount: inN, outCount: outN, inVoters: ins };
  }, [planVoters, seedInCount]);

  const lockedAt = formatLockTime(lockedAtIso, timeZone);
  const dayCopy = dayLabel(startsAt, timeZone);
  const timeCopy = formatShortTime(startsAt, timeZone);
  const subline = reasonLine(lockTrigger, liveInCount, recipientCount);
  const firstAddition = additions[0] ?? null;

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-in-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-in-strong">
          <span aria-hidden>✓</span>
          {lockedAt ? `Locked · ${lockedAt}` : "Locked"}
        </span>
        <h2 className="font-serif text-[40px] leading-[1.02] font-semibold text-ink sm:text-[44px]">
          It&rsquo;s happening.
        </h2>
        <p className="text-sm leading-relaxed text-ink-muted sm:text-base">
          {subline}
        </p>
      </header>

      {/* Dark coral "Tonight" card. Self-contained palette flip so the rest
          of the page stays paper/ink. */}
      <section
        className="flex flex-col gap-4 rounded-2xl bg-coral px-6 py-6 text-white shadow-[0_20px_40px_-24px_rgba(196,84,67,0.55)]"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75">
            {dayCopy}
          </span>
          {recipientCount > 0 ? (
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
              {recipientCount} {recipientCount === 1 ? "person" : "people"}
            </span>
          ) : null}
        </div>
        <p className="font-serif text-[56px] leading-[1] font-semibold tabular-nums text-white">
          {timeCopy}
        </p>
        <p className="text-base text-white/90">
          {location ?? "Venue TBD"}
        </p>
        {firstAddition ? (
          <p className="flex items-baseline gap-2 border-t border-white/15 pt-3 text-sm text-white/80">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
              Then
            </span>
            <span className="min-w-0 flex-1 truncate">
              {firstAddition.label ?? "Add-on"}
              <span aria-hidden> · </span>
              {formatShortTime(new Date(firstAddition.startsAt), timeZone)}
            </span>
          </p>
        ) : null}
      </section>

      {conflict ? <LockTimeConflictStrip conflict={conflict} /> : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="flex shrink-0 -space-x-1.5">
            {inVoters.length === 0 ? (
              <span className="size-7 rounded-full bg-ink/10" aria-hidden />
            ) : (
              inVoters
                .slice(0, 5)
                .map((v) => (
                  <Avatar
                    key={v.userId}
                    displayName={v.displayName}
                    avatarUrl={v.avatarUrl}
                  />
                ))
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-ink">
              {liveInCount} {liveInCount === 1 ? "person is" : "are"} in
            </span>
            {outCount > 0 ? (
              <span className="text-xs text-ink-muted">
                {outCount} out
              </span>
            ) : null}
          </div>
          {icsUrl ? (
            <a
              href={icsUrl}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
            >
              <CalendarPlus className="size-3.5" aria-hidden />
              Calendar
            </a>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-3 sm:flex-row">
        {mapsUrl ? (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-ink text-sm font-semibold text-paper transition-opacity hover:opacity-90",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral",
            )}
          >
            <MapPin className="size-4" aria-hidden />
            Directions
          </a>
        ) : null}
        <Link
          href={commentsHref}
          className={cn(
            "inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full border border-ink/15 bg-paper-card text-sm font-semibold text-ink transition-colors hover:bg-paper",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral",
          )}
        >
          <MessageCircle className="size-4" aria-hidden />
          Squad chat
        </Link>
      </section>
    </article>
  );
}

// M32.8 §4.4 — coral strip above the squad row. Two micro-actions: switch
// the OTHER plan to maybe (since this one's already locked), or open it.
// Spec deliberately keeps the strip narrow — the side-by-side compare
// sheet is reachable from the conflict push directly, not via the strip.
function LockTimeConflictStrip({ conflict }: { conflict: VoteConflict }) {
  const [hidden, setHidden] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (hidden) return null;

  const switchOtherToMaybe = () => {
    if (isPending) return;
    startTransition(async () => {
      try {
        await castVote({ planId: conflict.planId, status: "maybe" });
        setHidden(true); // resolved on this side; hide immediately
      } catch {
        setErr("Couldn't save. Try again.");
      }
    });
  };

  return (
    <section
      className="flex flex-col gap-2 rounded-2xl border border-coral/30 bg-coral-soft/40 px-4 py-3"
      role="status"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-coral" aria-hidden />
        <p className="text-sm leading-relaxed text-ink">
          You&rsquo;re also in for{" "}
          <span className="font-semibold">{conflict.planTitle}</span> at this
          time
          <span className="text-ink-muted">
            {" "}
            · {conflict.circleName}
          </span>
          .
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <button
          type="button"
          onClick={switchOtherToMaybe}
          disabled={isPending}
          className="rounded-full bg-maybe/15 px-3 py-1 text-xs font-semibold text-maybe transition-colors hover:bg-maybe/25 disabled:opacity-60"
        >
          Switch to maybe on {conflict.planTitle}
        </button>
        <Link
          href={`/c/${conflict.circleSlug}/p/${conflict.planId}`}
          className="rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold text-ink transition-colors hover:bg-ink/5"
        >
          Open the other plan
        </Link>
        {err ? (
          <span className="basis-full text-[11px] text-out">{err}</span>
        ) : null}
      </div>
    </section>
  );
}

function Avatar({
  displayName,
  avatarUrl,
}: {
  displayName: string;
  avatarUrl: string | null;
}) {
  const ringClass = "ring-2 ring-paper outline outline-2 outline-in/30";
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        className={cn("size-7 rounded-full object-cover", ringClass)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex size-7 items-center justify-center rounded-full bg-paper-card text-[10px] font-medium uppercase text-ink",
        ringClass,
      )}
      aria-hidden
    >
      {displayName.slice(0, 1)}
    </span>
  );
}
