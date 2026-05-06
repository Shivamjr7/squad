"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { getBrowserClient } from "./client";
import {
  castProposalVote,
  proposeTime,
} from "@/lib/actions/plan-time-proposals";
import { getBrowserTimeZone } from "@/lib/tz";

export type ProposalMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

export type ProposalRow = {
  id: string;
  startsAt: string;
  proposedBy: string | null;
  proposerName: string | null;
  createdAt: string;
};

type State = {
  proposals: Map<string, ProposalRow>;
  // Map<proposalId, Map<userId, ProposalMember>>
  votes: Map<string, Map<string, ProposalMember>>;
};

type CtxValue = {
  proposals: ProposalRow[];
  totalVoters: number;
  topProposalId: string | null;
  myProposalId: string | null;
  count: (id: string) => number;
  isMine: (id: string) => boolean;
  vote: (id: string) => void;
  add: (startsAtLocal: string) => Promise<void>;
  pending: boolean;
};

const Ctx = createContext<CtxValue | null>(null);

export function useTimeProposals(): CtxValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useTimeProposals must be used inside <TimeProposalsProvider>",
    );
  }
  return v;
}

export type InitialProposalVoter = {
  proposalId: string;
  userId: string;
};

export function TimeProposalsProvider({
  planId,
  initialProposals,
  initialVoters,
  members,
  currentUserId,
  children,
}: {
  planId: string;
  initialProposals: ProposalRow[];
  initialVoters: InitialProposalVoter[];
  members: Record<string, ProposalMember>;
  currentUserId: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<State>(() => {
    const proposals = new Map<string, ProposalRow>();
    for (const p of initialProposals) proposals.set(p.id, p);
    const votes = new Map<string, Map<string, ProposalMember>>();
    for (const p of initialProposals) votes.set(p.id, new Map());
    for (const v of initialVoters) {
      const m = members[v.userId];
      if (!m) continue;
      const inner = votes.get(v.proposalId) ?? new Map();
      inner.set(v.userId, m);
      votes.set(v.proposalId, inner);
    }
    return { proposals, votes };
  });
  const [pending, startTransition] = useTransition();

  const membersRef = useRef(members);
  membersRef.current = members;

  useEffect(() => {
    const client = getBrowserClient();
    const channel = client
      .channel(`time-proposals:${planId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plan_time_proposals" },
        (payload) => {
          const newRow = payload.new as
            | {
                id?: string;
                plan_id?: string;
                starts_at?: string;
                proposed_by?: string | null;
                created_at?: string;
              }
            | null;
          const oldRow = payload.old as
            | { id?: string; plan_id?: string }
            | null;
          const targetPlan = newRow?.plan_id ?? oldRow?.plan_id;
          if (targetPlan !== planId) return;

          setState((prev) => {
            if (payload.eventType === "DELETE") {
              if (!oldRow?.id) return prev;
              const proposals = new Map(prev.proposals);
              const votes = new Map(prev.votes);
              proposals.delete(oldRow.id);
              votes.delete(oldRow.id);
              return { proposals, votes };
            }
            if (!newRow?.id || !newRow.starts_at) return prev;
            const proposals = new Map(prev.proposals);
            proposals.set(newRow.id, {
              id: newRow.id,
              startsAt: newRow.starts_at,
              proposedBy: newRow.proposed_by ?? null,
              proposerName:
                (newRow.proposed_by &&
                  membersRef.current[newRow.proposed_by]?.displayName) ??
                null,
              createdAt: newRow.created_at ?? new Date().toISOString(),
            });
            const votes = new Map(prev.votes);
            if (!votes.has(newRow.id)) votes.set(newRow.id, new Map());
            return { proposals, votes };
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plan_time_proposal_votes" },
        (payload) => {
          const newRow = payload.new as
            | { proposal_id?: string; user_id?: string }
            | null;
          const oldRow = payload.old as
            | { proposal_id?: string; user_id?: string }
            | null;
          setState((prev) => {
            const next = new Map(prev.votes);
            if (payload.eventType === "DELETE") {
              const pid = oldRow?.proposal_id;
              if (!pid || !next.has(pid)) return prev;
              const inner = new Map(next.get(pid) ?? new Map());
              if (oldRow?.user_id) inner.delete(oldRow.user_id);
              next.set(pid, inner);
              return { ...prev, votes: next };
            }
            const pid = newRow?.proposal_id;
            const uid = newRow?.user_id;
            if (!pid || !uid || !next.has(pid)) return prev;
            const m = membersRef.current[uid];
            if (!m) return prev;
            const inner = new Map(next.get(pid) ?? new Map());
            inner.set(uid, m);
            next.set(pid, inner);
            return { ...prev, votes: next };
          });
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [planId]);

  const proposals = useMemo(
    () =>
      Array.from(state.proposals.values()).sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [state.proposals],
  );

  const count = useCallback(
    (id: string) => state.votes.get(id)?.size ?? 0,
    [state.votes],
  );

  const isMine = useCallback(
    (id: string) => state.votes.get(id)?.has(currentUserId) ?? false,
    [state.votes, currentUserId],
  );

  const { topProposalId, totalVoters } = useMemo(() => {
    let top = -1;
    let topId: string | null = null;
    let unique = false;
    const allVoters = new Set<string>();
    for (const [id, inner] of state.votes.entries()) {
      const c = inner.size;
      for (const u of inner.keys()) allVoters.add(u);
      if (c > top) {
        top = c;
        topId = id;
        unique = true;
      } else if (c === top && c > 0) {
        unique = false;
      }
    }
    return {
      topProposalId: top > 0 && unique ? topId : null,
      totalVoters: allVoters.size,
    };
  }, [state.votes]);

  const myProposalId = useMemo(() => {
    for (const [id, inner] of state.votes.entries()) {
      if (inner.has(currentUserId)) return id;
    }
    return null;
  }, [state.votes, currentUserId]);

  const vote = useCallback(
    (proposalId: string) => {
      const me = membersRef.current[currentUserId];
      if (!me) return;
      const previousId = (() => {
        for (const [id, inner] of state.votes.entries()) {
          if (inner.has(currentUserId)) return id;
        }
        return null;
      })();
      const isRetract = previousId === proposalId;

      setState((prev) => {
        const next = new Map(prev.votes);
        for (const [id, inner] of next.entries()) {
          if (inner.has(currentUserId)) {
            const ni = new Map(inner);
            ni.delete(currentUserId);
            next.set(id, ni);
          }
        }
        if (!isRetract) {
          const inner = new Map(next.get(proposalId) ?? new Map());
          inner.set(currentUserId, me);
          next.set(proposalId, inner);
        }
        return { ...prev, votes: next };
      });

      startTransition(async () => {
        try {
          await castProposalVote({ planId, proposalId });
        } catch (err) {
          setState((prev) => {
            const next = new Map(prev.votes);
            for (const [id, inner] of next.entries()) {
              if (inner.has(currentUserId)) {
                const ni = new Map(inner);
                ni.delete(currentUserId);
                next.set(id, ni);
              }
            }
            if (previousId) {
              const inner = new Map(next.get(previousId) ?? new Map());
              inner.set(currentUserId, me);
              next.set(previousId, inner);
            }
            return { ...prev, votes: next };
          });
          const msg = err instanceof Error ? err.message : "Couldn't vote.";
          toast.error(msg);
        }
      });
    },
    [planId, state.votes, currentUserId],
  );

  const add = useCallback(
    async (startsAtLocal: string) => {
      try {
        await proposeTime({
          planId,
          startsAtLocal,
          timeZone: getBrowserTimeZone(),
          kind: "replacement",
        });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Couldn't propose time.";
        toast.error(msg);
        throw err;
      }
    },
    [planId],
  );

  const value = useMemo<CtxValue>(
    () => ({
      proposals,
      totalVoters,
      topProposalId,
      myProposalId,
      count,
      isMine,
      vote,
      add,
      pending,
    }),
    [
      proposals,
      totalVoters,
      topProposalId,
      myProposalId,
      count,
      isMine,
      vote,
      add,
      pending,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
