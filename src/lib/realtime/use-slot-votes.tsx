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
import { toggleSlotVote } from "@/lib/actions/time-slots";

// Per-slot voter registry. We store userId -> displayName so the UI can
// surface "Karan, Shreya, +2 free at 8 PM" if needed without re-fetching.
export type SlotMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

type SlotState = {
  // Map<slotId, Map<userId, SlotMember>>
  slots: Map<string, Map<string, SlotMember>>;
  // The slotId tipping a lock — when set, the parent should re-render the
  // plan in confirmed state. Server actions also revalidate the route, but
  // exposing the flag keeps optimistic UI from showing stale chips.
  lockedSlotId: string | null;
};

type CtxValue = {
  state: SlotState;
  myUserId: string;
  isMine: (slotId: string) => boolean;
  count: (slotId: string) => number;
  toggle: (slotId: string) => void;
  pending: boolean;
};

const Ctx = createContext<CtxValue | null>(null);

export function useSlotVotes(): CtxValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useSlotVotes must be used inside <SlotVotesProvider>");
  }
  return v;
}

export type InitialSlotVoter = {
  slotId: string;
  userId: string;
};

export function SlotVotesProvider({
  planId,
  slotIds,
  initialVoters,
  members,
  currentUserId,
  onLock,
  children,
}: {
  planId: string;
  slotIds: string[];
  initialVoters: InitialSlotVoter[];
  members: Record<string, SlotMember>;
  currentUserId: string;
  onLock?: () => void;
  children: ReactNode;
}) {
  const [state, setState] = useState<SlotState>(() => {
    const slots = new Map<string, Map<string, SlotMember>>();
    for (const slotId of slotIds) slots.set(slotId, new Map());
    for (const v of initialVoters) {
      const m = members[v.userId];
      if (!m) continue;
      const inner = slots.get(v.slotId) ?? new Map();
      inner.set(v.userId, m);
      slots.set(v.slotId, inner);
    }
    return { slots, lockedSlotId: null };
  });
  const [pending, startTransition] = useTransition();

  // Stable refs for the subscription callback.
  const membersRef = useRef(members);
  membersRef.current = members;
  const slotIdSetRef = useRef(new Set(slotIds));
  slotIdSetRef.current = new Set(slotIds);
  const onLockRef = useRef(onLock);
  onLockRef.current = onLock;

  const channelKey = useMemo(
    () => [...new Set(slotIds)].sort().join(","),
    [slotIds],
  );

  useEffect(() => {
    const client = getBrowserClient();
    const channel = client
      .channel(`slot-votes:${planId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "time_slot_votes" },
        (payload) => {
          const newRow = payload.new as
            | { slot_id?: string; user_id?: string }
            | null;
          const oldRow = payload.old as
            | { slot_id?: string; user_id?: string }
            | null;
          const slotId = newRow?.slot_id ?? oldRow?.slot_id;
          if (!slotId || !slotIdSetRef.current.has(slotId)) return;

          setState((prev) => {
            const next = new Map(prev.slots);
            const inner = new Map(next.get(slotId) ?? new Map());

            if (payload.eventType === "DELETE") {
              if (oldRow?.user_id) inner.delete(oldRow.user_id);
              next.set(slotId, inner);
              return { ...prev, slots: next };
            }

            if (!newRow?.user_id) return prev;
            const member = membersRef.current[newRow.user_id];
            if (!member) return prev;
            inner.set(newRow.user_id, member);
            next.set(slotId, inner);
            return { ...prev, slots: next };
          });
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [planId, channelKey]);

  const isMine = useCallback(
    (slotId: string) =>
      state.slots.get(slotId)?.has(currentUserId) ?? false,
    [state.slots, currentUserId],
  );

  const count = useCallback(
    (slotId: string) => state.slots.get(slotId)?.size ?? 0,
    [state.slots],
  );

  const toggle = useCallback(
    (slotId: string) => {
      const myMember = membersRef.current[currentUserId];
      if (!myMember) return;

      // Optimistic flip.
      const wasMine = state.slots.get(slotId)?.has(currentUserId) ?? false;
      setState((prev) => {
        const next = new Map(prev.slots);
        const inner = new Map(next.get(slotId) ?? new Map());
        if (wasMine) inner.delete(currentUserId);
        else inner.set(currentUserId, myMember);
        next.set(slotId, inner);
        return { ...prev, slots: next };
      });

      startTransition(async () => {
        try {
          const result = await toggleSlotVote({ planId, slotId });
          if (result.locked) {
            setState((prev) => ({ ...prev, lockedSlotId: slotId }));
            onLockRef.current?.();
          }
        } catch (err) {
          // Revert on failure.
          setState((prev) => {
            const next = new Map(prev.slots);
            const inner = new Map(next.get(slotId) ?? new Map());
            if (wasMine) inner.set(currentUserId, myMember);
            else inner.delete(currentUserId);
            next.set(slotId, inner);
            return { ...prev, slots: next };
          });
          const msg =
            err instanceof Error ? err.message : "Couldn't update.";
          toast.error(msg);
        }
      });
    },
    [planId, state.slots, currentUserId],
  );

  const value = useMemo<CtxValue>(
    () => ({ state, myUserId: currentUserId, isMine, count, toggle, pending }),
    [state, currentUserId, isMine, count, toggle, pending],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
