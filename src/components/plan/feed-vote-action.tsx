"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { castVote, removeVote } from "@/lib/actions/votes";
import { VoteButtons } from "@/components/votes/vote-buttons";
import type { VoteStatus } from "@/lib/validation/vote";
import { cn } from "@/lib/utils";

const COMMIT_DEBOUNCE_MS = 200;

// Vote action embedded in a feed-tab plan card. Lightweight version of
// PlanVotes — no realtime context dependency, just optimistic local state
// + the same debounced castVote / removeVote actions. When the user has
// already voted, the buttons collapse into a "You're In ✓" chip plus a
// muted "Change vote" link that re-expands the buttons.
//
// Past plans NEVER render this component — gate at the call site via
// effectiveStatus (Fix 3). The component itself doesn't do that check.
export function FeedVoteAction({
  planId,
  initialVote,
}: {
  planId: string;
  initialVote: VoteStatus | null;
}) {
  const [ownVote, setOwnVote] = useState<VoteStatus | null>(initialVote);
  const [expanded, setExpanded] = useState<boolean>(initialVote === null);
  const [, startTransition] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = (next: VoteStatus | null) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      startTransition(async () => {
        try {
          if (next === null) {
            await removeVote({ planId });
          } else {
            await castVote({ planId, status: next });
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Couldn't save vote.";
          toast.error(message, { description: "Tap to retry." });
          // Roll back the optimistic state so the UI reflects DB truth.
          setOwnVote(initialVote);
          setExpanded(initialVote === null);
        }
      });
    }, COMMIT_DEBOUNCE_MS);
  };

  const onChange = (next: VoteStatus | null) => {
    setOwnVote(next);
    if (next !== null) setExpanded(false);
    commit(next);
  };

  if (!expanded && ownVote) {
    return (
      <div className="flex items-center gap-3">
        <span className={cn("inline-flex items-center gap-1.5", VOTE_CHIP[ownVote])}>
          <Check className="size-3" aria-hidden />
          You&rsquo;re {VOTE_LABEL[ownVote]}
        </span>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs text-ink-muted underline-offset-2 hover:underline hover:text-ink"
        >
          Change vote
        </button>
      </div>
    );
  }

  return <VoteButtons selected={ownVote} onChange={onChange} size="default" />;
}

const VOTE_LABEL: Record<VoteStatus, string> = {
  in: "In",
  maybe: "Maybe",
  out: "Out",
};

const VOTE_CHIP: Record<VoteStatus, string> = {
  in: "rounded-full bg-in-soft px-2.5 py-1 text-xs font-semibold text-in-strong",
  maybe:
    "rounded-full bg-maybe-soft px-2.5 py-1 text-xs font-semibold text-maybe-strong",
  out: "rounded-full bg-out-soft px-2.5 py-1 text-xs font-semibold text-out-strong",
};
