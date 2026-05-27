"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { toggleAdditionVote } from "@/lib/actions/plan-time-proposals";
import { getBrowserClient } from "@/lib/realtime/client";
import { cn } from "@/lib/utils";

export type AdditionVoteMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

export type AdditionVoteRow = {
  id: string;
  label: string | null;
  startsAt: string;
  proposerName: string | null;
  createdAt: string;
};

export type InitialAdditionVoter = {
  proposalId: string;
  userId: string;
};

type Props = {
  planId: string;
  additions: AdditionVoteRow[];
  initialVoters: InitialAdditionVoter[];
  members: Record<string, AdditionVoteMember>;
  currentUserId: string;
  canVote: boolean;
  timeZone?: string;
};

type State = {
  additions: Map<string, AdditionVoteRow>;
  votes: Map<string, Map<string, AdditionVoteMember>>;
};

export function AdditionVoteList({
  planId,
  additions,
  initialVoters,
  members,
  currentUserId,
  canVote,
  timeZone,
}: Props) {
  const [state, setState] = useState<State>(() => {
    const additionMap = new Map<string, AdditionVoteRow>();
    for (const addition of additions) additionMap.set(addition.id, addition);
    const votes = new Map<string, Map<string, AdditionVoteMember>>();
    for (const addition of additions) votes.set(addition.id, new Map());
    for (const voter of initialVoters) {
      const member = members[voter.userId];
      if (!member) continue;
      const inner = votes.get(voter.proposalId) ?? new Map();
      inner.set(voter.userId, member);
      votes.set(voter.proposalId, inner);
    }
    return { additions: additionMap, votes };
  });
  const [, startTransition] = useTransition();
  const membersRef = useRef(members);
  membersRef.current = members;

  useEffect(() => {
    const client = getBrowserClient();
    const channel = client
      .channel(`proposals:plan:${planId}`)
      .on(
        "broadcast",
        { event: "proposal-vote.changed" },
        ({ payload }) => {
          const data = payload as {
            op: "upsert" | "delete";
            planId: string;
            proposalId: string;
            userId: string;
          };
          if (!data || data.planId !== planId || !data.proposalId) return;

          setState((prev) => {
            if (!prev.votes.has(data.proposalId)) return prev;
            const votes = new Map(prev.votes);
            const inner = new Map(votes.get(data.proposalId) ?? new Map());
            if (data.op === "delete") {
              inner.delete(data.userId);
            } else {
              const member = membersRef.current[data.userId];
              if (!member) return prev;
              inner.set(data.userId, member);
            }
            votes.set(data.proposalId, inner);
            return { ...prev, votes };
          });
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [planId]);

  const rows = useMemo(
    () =>
      Array.from(state.additions.values()).sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [state.additions],
  );

  const toggleVoteState = useCallback(
    (proposalId: string, shouldVote: boolean) => {
      const me = membersRef.current[currentUserId];
      if (!me) return;
      setState((prev) => {
        const votes = new Map(prev.votes);
        const inner = new Map(votes.get(proposalId) ?? new Map());
        if (shouldVote) inner.set(currentUserId, me);
        else inner.delete(currentUserId);
        votes.set(proposalId, inner);
        return { ...prev, votes };
      });
    },
    [currentUserId],
  );

  if (rows.length === 0) return null;

  const fmt = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  });

  return (
    <section className="flex flex-col gap-2">
      <span className="text-[8.5px] font-bold uppercase tracking-[0.16em] text-ink">
        Plus
      </span>
      <ul className="flex flex-col divide-y divide-ink/5 overflow-hidden rounded-xl border border-ink/8 bg-ink/[0.025]">
        {rows.map((addition) => {
          const voters = state.votes.get(addition.id) ?? new Map();
          const mine = voters.has(currentUserId);
          const count = voters.size;
          return (
            <li key={addition.id}>
              <button
                type="button"
                disabled={!canVote}
                aria-pressed={mine}
                onClick={() => {
                  if (!canVote) return;
                  const next = !mine;
                  toggleVoteState(addition.id, next);
                  startTransition(async () => {
                    try {
                      await toggleAdditionVote({
                        planId,
                        proposalId: addition.id,
                      });
                    } catch (err) {
                      toggleVoteState(addition.id, mine);
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : "Couldn't save add-on vote.",
                      );
                    }
                  });
                }}
                className={cn(
                  "flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors",
                  canVote && "hover:bg-ink/[0.04]",
                  mine && "bg-coral-soft/70",
                  "disabled:cursor-default",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors",
                    mine
                      ? "border-coral bg-coral text-white"
                      : "border-ink/20 text-transparent",
                  )}
                >
                  <Check className="size-3.5" strokeWidth={2.5} />
                </span>
                <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums text-ink-muted">
                  {fmt.format(new Date(addition.startsAt))}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-semibold text-ink">
                    {addition.label ?? "Add-on"}
                  </span>
                  <span className="truncate text-[10px] text-ink-muted">
                    {addition.proposerName
                      ? `proposed by ${addition.proposerName}`
                      : "proposed"}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] font-bold tabular-nums text-ink">
                  {count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
