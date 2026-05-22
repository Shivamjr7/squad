"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getBrowserClient } from "./client";
import type { VoteStatus } from "@/lib/validation/vote";

export type Voter = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  status: VoteStatus;
  // Optional ISO timestamp of when the vote was cast. Used by the plan-detail
  // voter list ("in · 2:18pm"). Optional so older callers and the optimistic
  // override path don't have to fabricate a value — when missing, callers
  // simply don't render the timestamp.
  votedAt?: string;
};

export type Member = { displayName: string; avatarUrl: string | null };

export type VotersByPlan = Record<string, Voter[]>;

export type CurrentUser = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

type CtxValue = {
  voters: VotersByPlan;
  currentUser: CurrentUser;
};

const Ctx = createContext<CtxValue | null>(null);

export function useCircleVotes(): CtxValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useCircleVotes must be used inside <CircleVotesProvider>.");
  }
  return v;
}

type VoteBroadcastPayload = {
  op: "upsert" | "delete";
  planId: string;
  userId: string;
  status?: VoteStatus;
  votedAt?: string;
};

/**
 * One Supabase Broadcast channel per known plan. Each plan's `castVote`
 * server action emits a `vote.changed` event on `votes:plan:<planId>`
 * after committing; this hook subscribes to every channel in
 * `knownPlanIds` and threads updates into a single `voters` map keyed
 * by planId.
 *
 * Why Broadcast (not postgres_changes): the previous M5 approach
 * required the anon role to SELECT votes through Realtime, which forces
 * a permissive RLS policy. Broadcast is pure pub/sub — RLS stays at
 * default-deny on the votes table and the anon key can't enumerate
 * vote rows. See SECURITY_PLAN.md phase 2.
 *
 * Spoofing risk: anyone with the anon key can SEND broadcasts too, so
 * a malicious client could push fake vote events to the same channel.
 * The UI rerenders with fake data, but DB state is authoritative — next
 * full page load re-fetches truth via Drizzle on the server.
 */
export function CircleVotesProvider({
  initialVoters,
  members,
  knownPlanIds,
  currentUser,
  children,
}: {
  initialVoters: VotersByPlan;
  members: Record<string, Member>;
  knownPlanIds: string[];
  currentUser: CurrentUser;
  children: ReactNode;
}) {
  const [voters, setVoters] = useState<VotersByPlan>(initialVoters);

  const membersRef = useRef(members);
  membersRef.current = members;

  // Re-subscribe only when the SET of plan IDs actually changes.
  const channelKey = useMemo(
    () => [...new Set(knownPlanIds)].sort().join(","),
    [knownPlanIds],
  );

  useEffect(() => {
    const client = getBrowserClient();
    const planIds = channelKey ? channelKey.split(",") : [];
    const channels = planIds.map((planId) => {
      const channel = client
        .channel(`votes:plan:${planId}`)
        .on(
          "broadcast",
          { event: "vote.changed" },
          ({ payload }) => {
            const data = payload as VoteBroadcastPayload;
            if (!data || data.planId !== planId || !data.userId) return;

            setVoters((prev) => {
              const list = prev[planId] ?? [];

              if (data.op === "delete") {
                return {
                  ...prev,
                  [planId]: list.filter((v) => v.userId !== data.userId),
                };
              }

              if (!data.status) return prev;
              const member = membersRef.current[data.userId];
              if (!member) return prev;

              const without = list.filter((v) => v.userId !== data.userId);
              return {
                ...prev,
                [planId]: [
                  ...without,
                  {
                    userId: data.userId,
                    displayName: member.displayName,
                    avatarUrl: member.avatarUrl,
                    status: data.status,
                    votedAt: data.votedAt,
                  },
                ],
              };
            });
          },
        )
        .subscribe();
      return channel;
    });

    return () => {
      for (const ch of channels) void client.removeChannel(ch);
    };
    // Re-subscribe only when the SET of plan IDs actually changes
    // (channelKey is the sorted-unique join). The effect derives the
    // list from channelKey itself, so knownPlanIds doesn't need to be in
    // deps — including it would tear down channels on every parent
    // re-render that produced a new array reference for the same set.
  }, [channelKey]);

  const value = useMemo<CtxValue>(
    () => ({ voters, currentUser }),
    [voters, currentUser],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
