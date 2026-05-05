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
import { addVenue, castVenueVote } from "@/lib/actions/plan-venues";

export type VenueMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

export type VenueRow = {
  id: string;
  label: string;
  suggestedBy: string | null;
  suggesterName: string | null;
  createdAt: string;
};

type State = {
  // Map<venueId, VenueRow>
  venues: Map<string, VenueRow>;
  // Map<venueId, Map<userId, VenueMember>>
  votes: Map<string, Map<string, VenueMember>>;
};

type CtxValue = {
  venues: VenueRow[];
  totalVoters: number;
  topVenueId: string | null;
  myVenueId: string | null;
  count: (venueId: string) => number;
  isMine: (venueId: string) => boolean;
  vote: (venueId: string) => void;
  add: (label: string) => Promise<void>;
  pending: boolean;
  myUserId: string;
};

const Ctx = createContext<CtxValue | null>(null);

export function useVenueVotes(): CtxValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useVenueVotes must be used inside <VenueVotesProvider>");
  }
  return v;
}

export type InitialVenueVoter = {
  venueId: string;
  userId: string;
};

export function VenueVotesProvider({
  planId,
  initialVenues,
  initialVoters,
  members,
  currentUserId,
  children,
}: {
  planId: string;
  initialVenues: VenueRow[];
  initialVoters: InitialVenueVoter[];
  members: Record<string, VenueMember>;
  currentUserId: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<State>(() => {
    const venues = new Map<string, VenueRow>();
    for (const v of initialVenues) venues.set(v.id, v);
    const votes = new Map<string, Map<string, VenueMember>>();
    for (const v of initialVenues) votes.set(v.id, new Map());
    for (const vv of initialVoters) {
      const m = members[vv.userId];
      if (!m) continue;
      const inner = votes.get(vv.venueId) ?? new Map();
      inner.set(vv.userId, m);
      votes.set(vv.venueId, inner);
    }
    return { venues, votes };
  });
  const [pending, startTransition] = useTransition();

  const membersRef = useRef(members);
  membersRef.current = members;

  useEffect(() => {
    const client = getBrowserClient();
    const channel = client
      .channel(`venue-votes:${planId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plan_venues" },
        (payload) => {
          const newRow = payload.new as
            | {
                id?: string;
                plan_id?: string;
                label?: string;
                suggested_by?: string | null;
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
              const venues = new Map(prev.venues);
              const votes = new Map(prev.votes);
              venues.delete(oldRow.id);
              votes.delete(oldRow.id);
              return { venues, votes };
            }
            if (!newRow?.id || !newRow.label) return prev;
            const venues = new Map(prev.venues);
            venues.set(newRow.id, {
              id: newRow.id,
              label: newRow.label,
              suggestedBy: newRow.suggested_by ?? null,
              suggesterName:
                (newRow.suggested_by &&
                  membersRef.current[newRow.suggested_by]?.displayName) ??
                null,
              createdAt: newRow.created_at ?? new Date().toISOString(),
            });
            const votes = new Map(prev.votes);
            if (!votes.has(newRow.id)) votes.set(newRow.id, new Map());
            return { venues, votes };
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plan_venue_votes" },
        (payload) => {
          const newRow = payload.new as
            | { venue_id?: string; user_id?: string }
            | null;
          const oldRow = payload.old as
            | { venue_id?: string; user_id?: string }
            | null;

          setState((prev) => {
            const next = new Map(prev.votes);

            if (payload.eventType === "DELETE") {
              const vid = oldRow?.venue_id;
              if (!vid || !next.has(vid)) return prev;
              const inner = new Map(next.get(vid) ?? new Map());
              if (oldRow?.user_id) inner.delete(oldRow.user_id);
              next.set(vid, inner);
              return { ...prev, votes: next };
            }

            const vid = newRow?.venue_id;
            const uid = newRow?.user_id;
            if (!vid || !uid || !next.has(vid)) return prev;
            const m = membersRef.current[uid];
            if (!m) return prev;
            const inner = new Map(next.get(vid) ?? new Map());
            inner.set(uid, m);
            next.set(vid, inner);
            return { ...prev, votes: next };
          });
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [planId]);

  const venues = useMemo(() => {
    return Array.from(state.venues.values()).sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [state.venues]);

  const count = useCallback(
    (venueId: string) => state.votes.get(venueId)?.size ?? 0,
    [state.votes],
  );

  const isMine = useCallback(
    (venueId: string) =>
      state.votes.get(venueId)?.has(currentUserId) ?? false,
    [state.votes, currentUserId],
  );

  // Single highest-vote venue id, or null on tie / no votes. The home card
  // and upcoming row use this to surface the leading venue without needing
  // server work.
  const { topVenueId, totalVoters } = useMemo(() => {
    let top = -1;
    let topId: string | null = null;
    let unique = false;
    const allVoters = new Set<string>();
    for (const [vid, inner] of state.votes.entries()) {
      const c = inner.size;
      for (const u of inner.keys()) allVoters.add(u);
      if (c > top) {
        top = c;
        topId = vid;
        unique = true;
      } else if (c === top && c > 0) {
        unique = false;
      }
    }
    return {
      topVenueId: top > 0 && unique ? topId : null,
      totalVoters: allVoters.size,
    };
  }, [state.votes]);

  const myVenueId = useMemo(() => {
    for (const [vid, inner] of state.votes.entries()) {
      if (inner.has(currentUserId)) return vid;
    }
    return null;
  }, [state.votes, currentUserId]);

  const vote = useCallback(
    (venueId: string) => {
      const me = membersRef.current[currentUserId];
      if (!me) return;
      const previousVenue = (() => {
        for (const [vid, inner] of state.votes.entries()) {
          if (inner.has(currentUserId)) return vid;
        }
        return null;
      })();
      const isRetract = previousVenue === venueId;

      // Optimistic: clear any prior vote, set new (or leave cleared on retract).
      setState((prev) => {
        const next = new Map(prev.votes);
        for (const [vid, inner] of next.entries()) {
          if (inner.has(currentUserId)) {
            const ni = new Map(inner);
            ni.delete(currentUserId);
            next.set(vid, ni);
          }
        }
        if (!isRetract) {
          const inner = new Map(next.get(venueId) ?? new Map());
          inner.set(currentUserId, me);
          next.set(venueId, inner);
        }
        return { ...prev, votes: next };
      });

      startTransition(async () => {
        try {
          await castVenueVote({ planId, venueId });
        } catch (err) {
          // Revert.
          setState((prev) => {
            const next = new Map(prev.votes);
            for (const [vid, inner] of next.entries()) {
              if (inner.has(currentUserId)) {
                const ni = new Map(inner);
                ni.delete(currentUserId);
                next.set(vid, ni);
              }
            }
            if (previousVenue) {
              const inner = new Map(next.get(previousVenue) ?? new Map());
              inner.set(currentUserId, me);
              next.set(previousVenue, inner);
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
    async (label: string) => {
      const trimmed = label.trim();
      if (trimmed.length === 0) return;
      try {
        await addVenue({ planId, label: trimmed });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't add venue.";
        toast.error(msg);
        throw err;
      }
    },
    [planId],
  );

  const value = useMemo<CtxValue>(
    () => ({
      venues,
      totalVoters,
      topVenueId,
      myVenueId,
      count,
      isMine,
      vote,
      add,
      pending,
      myUserId: currentUserId,
    }),
    [
      venues,
      totalVoters,
      topVenueId,
      myVenueId,
      count,
      isMine,
      vote,
      add,
      pending,
      currentUserId,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
