"use client";

import { useMemo } from "react";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";

// Stacked progress bar: green/amber/red segments proportional to IN/MAYBE/OUT
// vote counts. Renders a hint row below: "4 IN  1 MAYBE  1 OUT". Counts hide
// segments at 0% so a single-status vote doesn't render thin slivers of the
// other colors.

export function VoteProgressBar({ planId }: { planId: string }) {
  const { voters } = useCircleVotes();
  const counts = useMemo(() => {
    const list = voters[planId] ?? [];
    let inN = 0;
    let maybeN = 0;
    let outN = 0;
    for (const v of list) {
      if (v.status === "in") inN += 1;
      else if (v.status === "maybe") maybeN += 1;
      else outN += 1;
    }
    return { in: inN, maybe: maybeN, out: outN, total: list.length };
  }, [voters, planId]);

  if (counts.total === 0) {
    return (
      <div className="flex flex-col gap-2">
        <div className="h-2 w-full rounded-full bg-paper" />
        <p className="text-xs text-ink-muted">No votes yet.</p>
      </div>
    );
  }

  const pct = (n: number) => (n / counts.total) * 100;

  return (
    <div className="flex flex-col gap-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={counts.total}
        aria-valuenow={counts.in}
        aria-label={`${counts.in} in, ${counts.maybe} maybe, ${counts.out} out`}
        className="flex h-2 w-full overflow-hidden rounded-full bg-paper"
      >
        {counts.in > 0 ? (
          <span
            className="block h-full bg-in"
            style={{ width: `${pct(counts.in)}%` }}
          />
        ) : null}
        {counts.maybe > 0 ? (
          <span
            className="block h-full bg-maybe"
            style={{ width: `${pct(counts.maybe)}%` }}
          />
        ) : null}
        {counts.out > 0 ? (
          <span
            className="block h-full bg-out"
            style={{ width: `${pct(counts.out)}%` }}
          />
        ) : null}
      </div>
      <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        <Tally label="In" value={counts.in} dot="bg-in" />
        <Tally label="Maybe" value={counts.maybe} dot="bg-maybe" />
        <Tally label="Out" value={counts.out} dot="bg-out" />
      </div>
    </div>
  );
}

function Tally({
  label,
  value,
  dot,
}: {
  label: string;
  value: number;
  dot: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
      <span className="tabular-nums text-ink">{value}</span>
      <span>{label}</span>
    </span>
  );
}
