"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserClient } from "./client";
import type { Member } from "./use-circle-votes";

export type PlanComment = {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  createdAt: string;
  pending?: boolean;
  failed?: boolean;
};

type Args = {
  planId: string;
  members: Record<string, Member>;
  initialComments: PlanComment[];
};

/**
 * Per-plan comments stream. One channel per planId, INSERTs only (v1 has no
 * edit/delete), filtered server-side via `plan_id=eq.<id>` so we never receive
 * other plans' rows.
 *
 * Optimistic UX flow:
 *   composer calls addOptimistic(temp) → server action runs → on success
 *   composer calls confirmOptimistic(tempId, canonical). If realtime delivers
 *   the canonical row first, dedupe-by-id keeps the list correct.
 *
 * RLS isn't configured in v1 (same posture as M5 votes); anyone with the anon
 * key could subscribe. Acceptable for the friend-app threat model.
 */
export function usePlanComments({ planId, members, initialComments }: Args) {
  const [comments, setComments] = useState<PlanComment[]>(initialComments);

  const membersRef = useRef(members);
  membersRef.current = members;

  useEffect(() => {
    const client = getBrowserClient();
    const channel = client
      .channel(`comments:${planId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "comments",
          filter: `plan_id=eq.${planId}`,
        },
        (payload) => {
          const row = payload.new as
            | {
                id?: string;
                user_id?: string;
                body?: string;
                created_at?: string;
              }
            | null;
          if (!row?.id || !row.user_id || !row.body || !row.created_at) return;
          const id = row.id;
          const userId = row.user_id;
          const body = row.body;
          const createdAt = row.created_at;

          setComments((prev) => {
            if (prev.some((c) => c.id === id)) return prev;
            const member = membersRef.current[userId];
            return [
              ...prev,
              {
                id,
                authorId: userId,
                authorName: member?.displayName ?? "Member",
                authorAvatarUrl: member?.avatarUrl ?? null,
                body,
                createdAt,
              },
            ];
          });
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [planId]);

  const addOptimistic = useCallback((c: PlanComment) => {
    setComments((prev) => [...prev, c]);
  }, []);

  const confirmOptimistic = useCallback(
    (tempId: string, canonical: PlanComment) => {
      setComments((prev) => {
        // If realtime already delivered the canonical row, just drop the temp.
        if (prev.some((c) => c.id === canonical.id)) {
          return prev.filter((c) => c.id !== tempId);
        }
        return prev.map((c) => (c.id === tempId ? canonical : c));
      });
    },
    [],
  );

  const failOptimistic = useCallback((tempId: string) => {
    setComments((prev) =>
      prev.map((c) =>
        c.id === tempId ? { ...c, pending: false, failed: true } : c,
      ),
    );
  }, []);

  const retryOptimistic = useCallback((tempId: string) => {
    setComments((prev) =>
      prev.map((c) =>
        c.id === tempId ? { ...c, pending: true, failed: false } : c,
      ),
    );
  }, []);

  return {
    comments,
    addOptimistic,
    confirmOptimistic,
    failOptimistic,
    retryOptimistic,
  };
}
