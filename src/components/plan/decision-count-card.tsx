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

  // Ticks once per minute so the deadline phrase ("auto at 5 in · 8:00 PM")
  // flips to "Locking any moment now" without a page refresh once decideBy
  // passes. Cheap — no per-second redraw needed since the headline copy
  // doesn't carry seconds.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    if (!decideBy) return;
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [decideBy]);

  const decideAt = decideBy ? new Date(decideBy) : null;
  const remaining = Math.max(0, lockThreshold - inCount);
  const deadlinePassed = decideAt ? decideAt.getTime() <= now.getTime() : false;

  let eyebrow: string;
  if (remaining <= 0 || deadlinePassed) {
    eyebrow = "Locking any moment now";
  } else if (remaining === 1) {
    eyebrow = "One more to lock";
  } else {
    eyebrow = `${remaining} more to lock`;
  }

  const subline =
    decideAt && !deadlinePassed
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
          <span className="eyebrow text-coral-strong tracking-[0.12em]">
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
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}
