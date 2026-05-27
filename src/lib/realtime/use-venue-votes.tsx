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
  votersFor: (venueId: string) => VenueMember[];
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
      .channel(`venues:plan:${planId}`)
      .on(
        "broadcast",
        { event: "venue.changed" },
        ({ payload }) => {
          const data = payload as {
            op: "upsert" | "delete";
            planId: string;
            id: string;
            label?: string;
            suggestedBy?: string | null;
            createdAt?: string;
          };
          if (!data || data.planId !== planId || !data.id) return;

          setState((prev) => {
            if (data.op === "delete") {
              const venues = new Map(prev.venues);
              const votes = new Map(prev.votes);
              venues.delete(data.id);
              votes.delete(data.id);
              return { venues, votes };
            }
            if (!data.label) return prev;
            const venues = new Map(prev.venues);
            venues.set(data.id, {
              id: data.id,
              label: data.label,
              suggestedBy: data.suggestedBy ?? null,
              suggesterName:
                (data.suggestedBy &&
                  membersRef.current[data.suggestedBy]?.displayName) ??
                null,
              createdAt: data.createdAt ?? new Date().toISOString(),
            });
            const votes = new Map(prev.votes);
            if (!votes.has(data.id)) votes.set(data.id, new Map());
            return { venues, votes };
          });
        },
      )
      .on(
        "broadcast",
        { event: "venue-vote.changed" },
        ({ payload }) => {
          const data = payload as {
            op: "upsert" | "delete";
            planId: string;
            venueId: string;
            userId: string;
          };
          if (!data || data.planId !== planId) return;

          setState((prev) => {
            const next = new Map(prev.votes);
            const vid = data.venueId;
            if (!vid || !next.has(vid)) return prev;

            const inner = new Map(next.get(vid) ?? new Map());
            if (data.op === "delete") {
              if (data.userId) inner.delete(data.userId);
              next.set(vid, inner);
              return { ...prev, votes: next };
            }

            if (!data.userId) return prev;
            const m = membersRef.current[data.userId];
            if (!m) return prev;
            inner.set(data.userId, m);
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

  const votersFor = useCallback(
    (venueId: string): VenueMember[] => {
      const inner = state.votes.get(venueId);
      if (!inner) return [];
      return Array.from(inner.values());
    },
    [state.votes],
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
        const created = await addVenue({ planId, label: trimmed });
        setState((prev) => {
          if (prev.venues.has(created.venueId)) return prev;
          const venues = new Map(prev.venues);
          venues.set(created.venueId, {
            id: created.venueId,
            label: created.label,
            suggestedBy: currentUserId,
            suggesterName: membersRef.current[currentUserId]?.displayName ?? null,
            createdAt: created.createdAt,
          });
          const votes = new Map(prev.votes);
          if (!votes.has(created.venueId)) {
            votes.set(created.venueId, new Map());
          }
          return { venues, votes };
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't add venue.";
        toast.error(msg);
        throw err;
      }
    },
    [planId, currentUserId],
  );

  const value = useMemo<CtxValue>(
    () => ({
      venues,
      totalVoters,
      topVenueId,
      myVenueId,
      count,
      isMine,
      votersFor,
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
      votersFor,
      vote,
      add,
      pending,
      currentUserId,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
