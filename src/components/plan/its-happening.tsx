"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CalendarPlus, MapPin, MessageCircle } from "lucide-react";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";
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
