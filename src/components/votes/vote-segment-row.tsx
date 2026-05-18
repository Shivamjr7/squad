"use client";

import { useMemo } from "react";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";

// M31.5 — discrete segmented progress used by the Live Ticker variant.
// One pill per recipient slot: filled green when that "slot" is taken by
// an `in` vote, amber for `maybe`, red for `out`, muted for unvoted. The
// fill order is fixed (in → maybe → out → unvoted) so the bar reads
// left-to-right as a commitment thermometer rather than per-person.
// Decision card keeps the continuous VoteSpectrumBar.

type Tone = "light" | "dark";

export function VoteSegmentRow({
  planId,
  totalSlots,
  tone = "dark",
}: {
  planId: string;
  totalSlots: number;
  tone?: Tone;
}) {
  const { voters } = useCircleVotes();
  const counts = useMemo(() => {
    const list = voters[planId] ?? [];
    let i = 0;
    let m = 0;
    let o = 0;
    for (const v of list) {
      if (v.status === "in") i += 1;
      else if (v.status === "maybe") m += 1;
      else o += 1;
    }
    return { i, m, o };
  }, [voters, planId]);

  const slots = Math.max(1, totalSlots);
  const mutedClass =
    tone === "dark" ? "bg-white/10" : "bg-ink/10";

  const cells: Array<"in" | "maybe" | "out" | "muted"> = [];
  for (let idx = 0; idx < slots; idx++) {
    if (idx < counts.i) cells.push("in");
    else if (idx < counts.i + counts.m) cells.push("maybe");
    else if (idx < counts.i + counts.m + counts.o) cells.push("out");
    else cells.push("muted");
  }

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={slots}
      aria-valuenow={counts.i}
      aria-label={`${counts.i} in, ${counts.m} maybe, ${counts.o} out of ${slots}`}
      className="grid w-full gap-1.5"
      style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}
    >
      {cells.map((kind, idx) => (
        <span
          key={idx}
          className={
            "h-3 rounded-md " +
            (kind === "in"
              ? "bg-in"
              : kind === "maybe"
                ? "bg-maybe"
                : kind === "out"
                  ? "bg-out"
                  : mutedClass)
          }
        />
      ))}
    </div>
  );
}
