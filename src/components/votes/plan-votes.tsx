"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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

// `undefined` = no pending optimistic override, defer to canonical state.
// `null` = user wants their vote removed.
// VoteStatus = user wants to cast that status.
type PendingVote = VoteStatus | null | undefined;

export function PlanVotes({ planId }: { planId: string }) {
  const { voters, currentUser } = useCircleVotes();
  const planVoters: Voter[] = useMemo(
    () => voters[planId] ?? [],
    [voters, planId],
  );

  const [pendingVote, setPendingVote] = useState<PendingVote>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Once realtime delivers our own vote in a state matching the optimistic
  // override, drop the override so future realtime updates flow straight
  // through.
  useEffect(() => {
    if (pendingVote === undefined) return;
    const canonical =
      planVoters.find((v) => v.userId === currentUser.id)?.status ?? null;
    if (canonical === pendingVote) {
      setPendingVote(undefined);
    }
  }, [planVoters, pendingVote, currentUser.id]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const ownVote: VoteStatus | null =
    pendingVote !== undefined
      ? pendingVote
      : (planVoters.find((v) => v.userId === currentUser.id)?.status ?? null);

  const displayVoters = useMemo<Voter[]>(() => {
    if (pendingVote === undefined) return planVoters;
    const without = planVoters.filter((v) => v.userId !== currentUser.id);
    if (pendingVote === null) return without;
    return [
      ...without,
      {
        userId: currentUser.id,
        displayName: currentUser.displayName,
        avatarUrl: currentUser.avatarUrl,
        status: pendingVote,
      },
    ];
  }, [planVoters, pendingVote, currentUser]);

  const onChange = (next: VoteStatus | null) => {
    setPendingVote(next);
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
          setPendingVote(undefined);
          const message =
            err instanceof Error ? err.message : "Couldn't save vote.";
          toast.error(message, { description: "Tap to retry." });
        }
      })();
    }, COMMIT_DEBOUNCE_MS);
  };

  return (
    <div className="flex flex-col gap-3">
      <VoteButtons selected={ownVote} onChange={onChange} />
      <VoteTally voters={displayVoters} />
    </div>
  );
}
