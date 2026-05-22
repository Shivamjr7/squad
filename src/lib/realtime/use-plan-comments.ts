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

type CommentAddedPayload = {
  id: string;
  planId: string;
  userId: string;
  body: string;
  createdAt: string;
};

type CommentDeletedPayload = {
  id: string;
  planId: string;
};

/**
 * Per-plan comment stream. Subscribes to `comments:plan:<planId>` and
 * listens for `comment.added` and `comment.deleted` broadcasts emitted
 * by the addComment / deleteComment server actions.
 *
 * Same broadcast-vs-postgres-changes reasoning as use-circle-votes:
 * keeps RLS at default-deny on the `comments` table so the anon key
 * can't enumerate comment bodies.
 *
 * Optimistic UX flow:
 *   composer calls addOptimistic(temp) → server action runs → on success
 *   composer calls confirmOptimistic(tempId, canonical). If the broadcast
 *   delivers the canonical row first, dedupe-by-id keeps the list correct.
 */
export function usePlanComments({ planId, members, initialComments }: Args) {
  const [comments, setComments] = useState<PlanComment[]>(initialComments);

  const membersRef = useRef(members);
  membersRef.current = members;

  useEffect(() => {
    const client = getBrowserClient();
    const channel = client
      .channel(`comments:plan:${planId}`)
      .on(
        "broadcast",
        { event: "comment.added" },
        ({ payload }) => {
          const row = payload as CommentAddedPayload;
          if (!row?.id || !row.userId || !row.body || !row.createdAt) return;
          if (row.planId !== planId) return;
          const { id, userId, body, createdAt } = row;

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
      .on(
        "broadcast",
        { event: "comment.deleted" },
        ({ payload }) => {
          const row = payload as CommentDeletedPayload;
          if (!row?.id || row.planId !== planId) return;
          const id = row.id;
          setComments((prev) => prev.filter((c) => c.id !== id));
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
        // If the broadcast already delivered the canonical row, drop the temp.
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

  const removeOptimistic = useCallback((id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const restoreOptimistic = useCallback((c: PlanComment) => {
    setComments((prev) => {
      if (prev.some((x) => x.id === c.id)) return prev;
      // Reinsert in createdAt order so a failed delete doesn't shuffle the list.
      const next = [...prev, c];
      next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return next;
    });
  }, []);

  return {
    comments,
    addOptimistic,
    confirmOptimistic,
    failOptimistic,
    retryOptimistic,
    removeOptimistic,
    restoreOptimistic,
  };
}
