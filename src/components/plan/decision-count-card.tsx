"use client";

import { useEffect, useMemo, useState } from "react";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";
import { VoteSpectrumBar } from "@/components/votes/vote-spectrum-bar";

type Props = {
  planId: string;
  lockThreshold: number;
  recipientCount: number;
  decideBy: string | null; // ISO
  timeZone?: string;
};

// M31.2 — the big "X / Y in" hero that sits at the top of the Current
// Plan stack on the Decision card variant. Reads live counts via
// useCircleVotes so the numerator + lock copy update as votes land,
// without re-fetching. The right column carries the lock copy that
// previously sat in LockFooter — surfacing it inline next to the count
// matches the reference mock and removes the "what unlocks this?" gap.
export function DecisionCountCard({
  planId,
  lockThreshold,
  recipientCount,
  decideBy,
  timeZone,
}: Props) {
  const { voters } = useCircleVotes();
  const inCount = useMemo(() => {
    const list = voters[planId] ?? [];
    let n = 0;
    for (const v of list) if (v.status === "in") n += 1;
    return n;
  }, [voters, planId]);

  // `now` starts null so the first render (server + client hydration)
  // never depends on the wall clock — avoids the hydration mismatch a
  // lazy `new Date()` init would cause. The mount effect seeds it; a
  // second interval (when decideBy is set) ticks once per minute so the
  // deadline phrase flips to "Locking any moment now" without a refresh.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);
  useEffect(() => {
    if (!decideBy) return;
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [decideBy]);

  const decideAt = decideBy ? new Date(decideBy) : null;
  const remaining = Math.max(0, lockThreshold - inCount);
  const deadlinePassed =
    decideAt && now ? decideAt.getTime() <= now.getTime() : false;

  // Lapsed = deadline already gone but the threshold never landed. No
  // cron force-locks these today, so "Locking any moment now" would lie.
  // Threshold-met-but-still-active is a transient race; the in-app vote
  // path locks within milliseconds, so we keep the urgent copy for it.
  const isLapsed = deadlinePassed && remaining > 0;

  let eyebrow: string;
  if (isLapsed) {
    eyebrow = "Lapsed";
  } else if (remaining <= 0) {
    eyebrow = "Locking any moment now";
  } else if (remaining === 1) {
    eyebrow = "One more to lock";
  } else {
    eyebrow = `${remaining} more to lock`;
  }

  const subline = isLapsed
    ? "Deadline passed · vote to revive"
    : decideAt && !deadlinePassed
      ? `auto at ${lockThreshold} in · ${shortTime(decideAt, timeZone)}`
      : `auto at ${lockThreshold} in`;

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-paper-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-baseline gap-1.5">
          <span className="font-serif text-5xl font-semibold leading-none text-in-strong tabular-nums">
            {inCount}
          </span>
          <span className="font-serif text-2xl leading-none text-ink-muted">
            /{recipientCount}
          </span>
          <span className="ml-1 text-sm text-ink-muted">in</span>
        </div>
        <div className="flex flex-col items-end gap-1 pt-1 text-right">
          <span
            className={
              "eyebrow tracking-[0.12em] " +
              (isLapsed ? "text-ink-muted" : "text-coral-strong")
            }
          >
            {eyebrow}
          </span>
          <span className="text-[11px] text-ink-muted tabular-nums">
            {subline}
          </span>
        </div>
      </div>
      <VoteSpectrumBar planId={planId} tone="light" />
    </section>
  );
}

function shortTime(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}
