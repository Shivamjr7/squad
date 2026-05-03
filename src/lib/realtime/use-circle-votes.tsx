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

/**
 * One realtime channel per circle. We subscribe to ALL row changes on the
 * `votes` table and discard rows whose plan_id isn't in `knownPlanIds` on the
 * client.
 *
 * Why filter in JS instead of `plan_id=in.(...)`:
 *   - The `votes` table has no `circle_id` column, so a server-side filter
 *     would have to enumerate every plan ID in the circle. New plans created
 *     mid-session wouldn't be picked up without resubscribing.
 *   - At v1 scale (~12 users x ~10 active plans per circle) the volume of
 *     unrelated payloads is trivial and lifecycle simplicity wins.
 *   - This explicitly does NOT scale to 1000-plan circles. We don't have those.
 *
 * Privacy: Supabase RLS isn't configured (PLAN.md v1 friend-app threat
 * model). Anyone holding the anon key could subscribe to any vote. Acceptable
 * for v1; revisit before opening to strangers.
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

  // Members and the known-id set get accessed inside the subscription
  // callback. Using refs keeps the effect from re-subscribing on every
  // render when the parent passes fresh object identities.
  const membersRef = useRef(members);
  membersRef.current = members;
  const knownIdsRef = useRef(new Set(knownPlanIds));
  knownIdsRef.current = new Set(knownPlanIds);

  // Re-subscribe only when the SET of plan IDs actually changes.
  const channelKey = useMemo(
    () => [...new Set(knownPlanIds)].sort().join(","),
    [knownPlanIds],
  );

  useEffect(() => {
    const client = getBrowserClient();
    const channel = client
      .channel(`votes:${channelKey || "empty"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "votes" },
        (payload) => {
          const newRow = payload.new as
            | {
                plan_id?: string;
                user_id?: string;
                status?: VoteStatus;
                voted_at?: string;
              }
            | null;
          const oldRow = payload.old as
            | { plan_id?: string; user_id?: string }
            | null;
          const planId = newRow?.plan_id ?? oldRow?.plan_id;
          if (!planId || !knownIdsRef.current.has(planId)) return;

          setVoters((prev) => {
            const list = prev[planId] ?? [];

            if (payload.eventType === "DELETE") {
              if (!oldRow?.user_id) return prev;
              return {
                ...prev,
                [planId]: list.filter((v) => v.userId !== oldRow.user_id),
              };
            }

            if (!newRow?.user_id || !newRow.status) return prev;
            const member = membersRef.current[newRow.user_id];
            if (!member) return prev;

            const without = list.filter((v) => v.userId !== newRow.user_id);
            return {
              ...prev,
              [planId]: [
                ...without,
                {
                  userId: newRow.user_id,
                  displayName: member.displayName,
                  avatarUrl: member.avatarUrl,
                  status: newRow.status,
                  votedAt: newRow.voted_at,
                },
              ],
            };
          });
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [channelKey]);

  const value = useMemo<CtxValue>(
    () => ({ voters, currentUser }),
    [voters, currentUser],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
