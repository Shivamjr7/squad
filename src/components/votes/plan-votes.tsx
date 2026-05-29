"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConflictWarningSheet } from "@/components/plan/conflict-warning-sheet";
import {
  getConflictForVote,
  type VoteConflict,
} from "@/lib/actions/conflicts";
import { castVote, removeVote } from "@/lib/actions/votes";
import {
  useCircleVotes,
  type Voter,
} from "@/lib/realtime/use-circle-votes";
import type { VoteStatus } from "@/lib/validation/vote";
import { VoteButtons } from "./vote-buttons";
import { VoteTally } from "./vote-tally";

// Debounce window for the actual server call. Optimistic UI updates fire
// immediately; rapid taps within this window collapse to a single request so
// "in → out → in → out" doesn't spawn four round-trips. Last tap wins.
const COMMIT_DEBOUNCE_MS = 200;

export function PlanVotes({
  planId,
  showFirstVoteHint: showHint = false,
  density = "card",
  buttonSize = "default",
  showTally = true,
}: {
  planId: string;
  showFirstVoteHint?: boolean;
  density?: "card" | "detail";
  buttonSize?: "default" | "lg";
  showTally?: boolean;
}) {
  const {
    voters,
    currentUser,
    setOptimisticVote,
    clearOptimisticVote,
  } = useCircleVotes();
  const planVoters: Voter[] = useMemo(
    () => voters[planId] ?? [],
    [voters, planId],
  );

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // M32.3 — pre-vote conflict sheet (CONVERGENCE_PLAN.md §4.1).
  // `conflictGen` discards stale conflict-check results when the user
  // changes their tap mid-roundtrip. Only IN-edge taps run the check; the
  // sheet only opens on a *hard* hit, so MAYBE/OUT taps and approximate
  // targets bypass it entirely.
  const [conflict, setConflict] = useState<VoteConflict | null>(null);
  const conflictGenRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const ownVote: VoteStatus | null =
    planVoters.find((v) => v.userId === currentUser.id)?.status ?? null;

  // Debounced server commit. Pulled out so the conflict sheet can defer the
  // network call until the user accepts the double-booking, without
  // duplicating the toast / cleanup branch.
  const commit = (next: VoteStatus | null) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void (async () => {
        try {
          if (next === null) {
            await removeVote({ planId });
          } else {
            await castVote({ planId, status: next });
          }
        } catch (err) {
          clearOptimisticVote(planId);
          const message =
            err instanceof Error ? err.message : "Couldn't save vote.";
          toast.error(message, { description: "Tap to retry." });
        }
      })();
    }, COMMIT_DEBOUNCE_MS);
  };

  const onChange = (next: VoteStatus | null) => {
    // Apply the optimistic state immediately either way — speed > polish per
    // CLAUDE.md. The sheet (if it opens) is purely a confirmation; the green
    // pill is already lit while the check runs in the background.
    setOptimisticVote(planId, next);

    // Only IN-edge taps need the conflict check. Switching from in→out, or
    // tapping MAYBE/OUT, can't create a new hard double-booking. Re-taps on
    // the same IN are also no-ops (`ownVote === "in"` means we already
    // committed and any other IN tap would clear via the toggle).
    const isInEdge = next === "in" && ownVote !== "in";
    if (!isInEdge) {
      commit(next);
      return;
    }

    const gen = ++conflictGenRef.current;
    void getConflictForVote(planId)
      .then((c) => {
        if (gen !== conflictGenRef.current) return;
        if (!c) {
          commit("in");
          return;
        }
        setConflict(c);
      })
      .catch(() => {
        // Conflict detection is best-effort. Never block voting on it.
        if (gen !== conflictGenRef.current) return;
        commit("in");
      });
  };

  const onConfirmConflict = () => {
    setConflict(null);
    commit("in");
  };

  const onCancelConflict = () => {
    setConflict(null);
    // Invalidate any in-flight check so a late result can't re-open the
    // sheet after the user dismissed it.
    conflictGenRef.current += 1;
    // Drop the optimistic IN so the buttons fall back to the canonical
    // realtime state (the previous vote, or nothing).
    clearOptimisticVote(planId);
  };

  // Hint only on the plan detail page (caller opts in). Covers both "no
  // votes at all" and "creator auto-in is the only vote, you're a viewer".
  const showFirstVoteHint =
    showHint &&
    planVoters.length <= 1 &&
    !planVoters.some((v) => v.userId === currentUser.id);

  return (
    <div className="flex flex-col gap-3">
      {showFirstVoteHint ? (
        <p className="text-xs text-muted-foreground">
          First vote sets the energy. Tap In, Out, or Maybe.
        </p>
      ) : null}
      <VoteButtons selected={ownVote} onChange={onChange} size={buttonSize} />
      {showTally ? (
        <VoteTally voters={planVoters} density={density} />
      ) : null}
      <ConflictWarningSheet
        open={conflict !== null}
        conflict={conflict}
        onConfirm={onConfirmConflict}
        onCancel={onCancelConflict}
      />
    </div>
  );
}
