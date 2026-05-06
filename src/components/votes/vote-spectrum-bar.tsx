"use client";

import { useMemo } from "react";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";

// M24 — slim, label-less green/amber/red bar that runs across the top of
// the Current Plan card (Variant A) and below the big "X / Y in" hero on
// the Live Ticker (Variant B). No tally row — kept intentionally minimal so
// the bar reads as a status spectrum rather than a stat block.

type Tone = "light" | "dark";

export function VoteSpectrumBar({
  planId,
  tone = "light",
}: {
  planId: string;
  tone?: Tone;
}) {
  const { voters } = useCircleVotes();
  const { inN, maybeN, outN, total } = useMemo(() => {
    const list = voters[planId] ?? [];
    let i = 0;
    let m = 0;
    let o = 0;
    for (const v of list) {
      if (v.status === "in") i += 1;
      else if (v.status === "maybe") m += 1;
      else o += 1;
    }
    return { inN: i, maybeN: m, outN: o, total: list.length };
  }, [voters, planId]);

  const trackBg = tone === "dark" ? "bg-white/10" : "bg-ink/10";

  if (total === 0) {
    return <div className={`h-1.5 w-full rounded-full ${trackBg}`} />;
  }

  const pct = (n: number) => (n / total) * 100;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={inN}
      aria-label={`${inN} in, ${maybeN} maybe, ${outN} out`}
      className={`flex h-1.5 w-full overflow-hidden rounded-full ${trackBg}`}
    >
      {inN > 0 ? (
        <span
          className="block h-full bg-in"
          style={{ width: `${pct(inN)}%` }}
        />
      ) : null}
      {maybeN > 0 ? (
        <span
          className="block h-full bg-maybe"
          style={{ width: `${pct(maybeN)}%` }}
        />
      ) : null}
      {outN > 0 ? (
        <span
          className="block h-full bg-out"
          style={{ width: `${pct(outN)}%` }}
        />
      ) : null}
    </div>
  );
}
