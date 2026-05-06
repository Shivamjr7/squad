"use client";

import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { addComment } from "@/lib/actions/comments";
import {
  usePlanComments,
  type PlanComment,
} from "@/lib/realtime/use-plan-comments";
import type { Member } from "@/lib/realtime/use-circle-votes";
import { CommentThread } from "./comment-thread";
import { CommentComposer } from "./comment-composer";

type Props = {
  planId: string;
  members: Record<string, Member>;
  initialComments: PlanComment[];
  currentUser: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  };
  // M23 — non-recipients (e.g. an admin viewing a restricted plan) can read
  // the discussion but can't post; the composer is hidden when false.
  canCompose?: boolean;
};

function makeTempId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `tmp:${crypto.randomUUID()}`;
  }
  return `tmp:${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function PlanComments({
  planId,
  members,
  initialComments,
  currentUser,
  canCompose = true,
}: Props) {
  const {
    comments,
    addOptimistic,
    confirmOptimistic,
    failOptimistic,
    retryOptimistic,
  } = usePlanComments({ planId, members, initialComments });

  // Track body text by tempId so retries don't depend on closure capture.
  const pendingBodies = useRef(new Map<string, string>());

  const send = useCallback(
    async (tempId: string, body: string) => {
      try {
        const canonical = await addComment({ planId, body });
        confirmOptimistic(tempId, {
          id: canonical.id,
          authorId: canonical.userId,
          authorName: currentUser.displayName,
          authorAvatarUrl: currentUser.avatarUrl,
          body: canonical.body,
          createdAt: canonical.createdAt,
        });
        pendingBodies.current.delete(tempId);
      } catch (err) {
        failOptimistic(tempId);
        const message =
          err instanceof Error ? err.message : "Couldn't send comment.";
        toast.error(message);
      }
    },
    [planId, confirmOptimistic, failOptimistic, currentUser],
  );

  const onSend = useCallback(
    (body: string) => {
      const tempId = makeTempId();
      pendingBodies.current.set(tempId, body);
      addOptimistic({
        id: tempId,
        authorId: currentUser.id,
        authorName: currentUser.displayName,
        authorAvatarUrl: currentUser.avatarUrl,
        body,
        createdAt: new Date().toISOString(),
        pending: true,
      });
      void send(tempId, body);
    },
    [addOptimistic, currentUser, send],
  );

  const onRetry = useCallback(
    (tempId: string) => {
      const body = pendingBodies.current.get(tempId);
      if (!body) return;
      retryOptimistic(tempId);
      void send(tempId, body);
    },
    [retryOptimistic, send],
  );

  return (
    <div className="flex flex-1 flex-col gap-4">
      <CommentThread
        comments={comments}
        currentUserId={currentUser.id}
        onRetry={onRetry}
      />
      {canCompose ? <CommentComposer onSend={onSend} /> : null}
    </div>
  );
}
