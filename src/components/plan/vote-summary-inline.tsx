"use client";

import { useMemo } from "react";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";

// Compact one-line vote summary for the upcoming list rows.
// Shows non-zero counts only — "5 in", "2 in · 3 ?", "1 in · 1 ? · 2 out".
// "?" is shorthand for maybe so the row stays narrow on a 380px viewport.

export function VoteSummaryInline({ planId }: { planId: string }) {
  const { voters } = useCircleVotes();
  const summary = useMemo(() => {
    const list = voters[planId] ?? [];
    let inN = 0;
    let maybeN = 0;
    let outN = 0;
    for (const v of list) {
      if (v.status === "in") inN += 1;
      else if (v.status === "maybe") maybeN += 1;
      else outN += 1;
    }
    const parts: string[] = [];
    if (inN) parts.push(`${inN} in`);
    if (maybeN) parts.push(`${maybeN} ?`);
    if (outN) parts.push(`${outN} out`);
    return parts.join(" · ");
  }, [voters, planId]);

  if (!summary) {
    return <span className="text-xs text-ink-muted">no votes</span>;
  }
  return <span className="text-xs text-ink-muted">{summary}</span>;
}
