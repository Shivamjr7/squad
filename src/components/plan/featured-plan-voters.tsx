"use client";

import { useMemo } from "react";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";
import { cn } from "@/lib/utils";

const AVATAR_LIMIT = 5;

export function FeaturedPlanVoters({ planId }: { planId: string }) {
  const { voters } = useCircleVotes();
  const planVoters = useMemo(() => voters[planId] ?? [], [voters, planId]);

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

  // Avatar stack prioritises IN voters (the people who matter most for the
  // headline summary), then MAYBE, then OUT.
  const stack = useMemo(() => {
    const ranked = [...planVoters].sort((a, b) => {
      const order = { in: 0, maybe: 1, out: 2 } as const;
      return order[a.status] - order[b.status];
    });
    return ranked.slice(0, AVATAR_LIMIT);
  }, [planVoters]);

  if (planVoters.length === 0) {
    return (
      <p className="text-xs text-ink-muted">No votes yet — be first.</p>
    );
  }

  const summaryParts: string[] = [];
  if (counts.in) summaryParts.push(`${counts.in} in`);
  if (counts.maybe) summaryParts.push(`${counts.maybe} maybe`);
  if (counts.out) summaryParts.push(`${counts.out} out`);

  return (
    <div className="flex items-center gap-3">
      <span className="flex shrink-0 -space-x-1.5">
        {stack.map((v) => (
          <Avatar
            key={v.userId}
            displayName={v.displayName}
            avatarUrl={v.avatarUrl}
            ring={v.status}
          />
        ))}
      </span>
      <span className="text-sm text-ink-muted">{summaryParts.join(" · ")}</span>
    </div>
  );
}

function Avatar({
  displayName,
  avatarUrl,
  ring,
}: {
  displayName: string;
  avatarUrl: string | null;
  ring: "in" | "maybe" | "out";
}) {
  const ringClass = cn(
    "ring-2 ring-paper-card",
    ring === "in" && "outline outline-2 outline-in/30",
    ring === "maybe" && "outline outline-2 outline-maybe/40",
    ring === "out" && "outline outline-2 outline-out/30",
  );
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
        "flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium uppercase",
        ringClass,
      )}
    >
      {displayName.slice(0, 1)}
    </span>
  );
}
