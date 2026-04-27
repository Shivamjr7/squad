"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { PlanComment } from "@/lib/realtime/use-plan-comments";

type Props = {
  comments: PlanComment[];
  currentUserId: string;
  onRetry: (tempId: string) => void;
};

// Threshold for "was the viewer near the bottom before the new message arrived".
// Generous so the composer height + a stray pixel of overflow don't disqualify.
const BOTTOM_PX = 120;

export function CommentThread({ comments, currentUserId, onRetry }: Props) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const lastCountRef = useRef(comments.length);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      wasAtBottomRef.current =
        doc.scrollHeight - doc.scrollTop - window.innerHeight < BOTTOM_PX;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const last = comments[comments.length - 1];
    const grew = comments.length > lastCountRef.current;
    lastCountRef.current = comments.length;
    if (!grew || !last) return;

    const ownPost = last.authorId === currentUserId;
    if (wasAtBottomRef.current || ownPost) {
      sentinelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
  }, [comments, currentUserId]);

  if (comments.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        No discussion yet. The first comment kicks things off.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {comments.map((c) => (
        <li
          key={c.id}
          className={cn(
            "flex gap-3",
            c.pending && !c.failed && "opacity-60",
            c.failed && "opacity-90",
          )}
        >
          {c.authorAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={c.authorAvatarUrl}
              alt=""
              className="size-7 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase">
              {c.authorName.slice(0, 1)}
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-sm font-medium">
                {c.authorName}
              </span>
              <span
                className="shrink-0 text-xs text-muted-foreground"
                suppressHydrationWarning
              >
                {c.pending && !c.failed
                  ? "sending…"
                  : formatRelative(c.createdAt)}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
            {c.failed ? (
              <button
                type="button"
                onClick={() => onRetry(c.id)}
                className="mt-1 self-start text-xs font-medium text-red-600 underline-offset-2 hover:underline"
              >
                Couldn&apos;t send · Retry
              </button>
            ) : null}
          </div>
        </li>
      ))}
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />
    </ul>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 30) return "now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
