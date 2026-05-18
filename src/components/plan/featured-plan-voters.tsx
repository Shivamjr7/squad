"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";
import { cn } from "@/lib/utils";
import { GradientAvatar } from "@/components/ui/gradient-avatar";

const AVATAR_LIMIT = 5;

export function FeaturedPlanVoters({ planId }: { planId: string }) {
  const { voters } = useCircleVotes();
  const planVoters = useMemo(() => voters[planId] ?? [], [voters, planId]);

  // Track which voter ids we've already seen so realtime arrivals get the
  // one-shot spring-in animation but initial paint stays static. The
  // first-paint set is seeded synchronously on mount; anything appearing
  // afterwards is treated as "new".
  const seenRef = useRef<Set<string> | null>(null);
  const [arrivingIds, setArrivingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (seenRef.current === null) {
      // Initial population — seed without animating anyone.
      seenRef.current = new Set(planVoters.map((v) => v.userId));
      return;
    }
    const fresh: string[] = [];
    for (const v of planVoters) {
      if (!seenRef.current.has(v.userId)) {
        fresh.push(v.userId);
        seenRef.current.add(v.userId);
      }
    }
    if (fresh.length === 0) return;
    setArrivingIds((prev) => {
      const next = new Set(prev);
      for (const id of fresh) next.add(id);
      return next;
    });
    // Animation runs ~420ms; clear the flag a bit after so re-renders
    // don't restart it. Independent timeout per batch keeps the logic
    // simple — overlapping batches naturally merge into the Set.
    const t = setTimeout(() => {
      setArrivingIds((prev) => {
        const next = new Set(prev);
        for (const id of fresh) next.delete(id);
        return next;
      });
    }, 500);
    return () => clearTimeout(t);
  }, [planVoters]);

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
            userId={v.userId}
            displayName={v.displayName}
            avatarUrl={v.avatarUrl}
            ring={v.status}
            arriving={arrivingIds.has(v.userId)}
          />
        ))}
      </span>
      <span className="text-sm text-ink-muted">{summaryParts.join(" · ")}</span>
    </div>
  );
}

function Avatar({
  userId,
  displayName,
  avatarUrl,
  ring,
  arriving,
}: {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  ring: "in" | "maybe" | "out";
  arriving: boolean;
}) {
  // Status-tone outline on top of the paper-card ring so the vote status
  // reads at a glance on overlapping stacks.
  const outlineClass = cn(
    ring === "in" && "outline outline-2 outline-in/30",
    ring === "maybe" && "outline outline-2 outline-maybe/40",
    ring === "out" && "outline outline-2 outline-out/30",
  );
  return (
    <GradientAvatar
      seed={userId}
      name={displayName}
      src={avatarUrl}
      size="md"
      className={cn(
        "ring-2 ring-paper-card",
        outlineClass,
        arriving && "animate-voter-arrive",
      )}
    />
  );
}
