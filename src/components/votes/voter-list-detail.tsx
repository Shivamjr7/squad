"use client";

import { useMemo } from "react";
import { useCircleVotes, type Voter } from "@/lib/realtime/use-circle-votes";
import type { VoteStatus } from "@/lib/validation/vote";
import { cn } from "@/lib/utils";

const STATUS_ORDER: Record<VoteStatus, number> = { in: 0, maybe: 1, out: 2 };

const STATUS_PILL: Record<
  VoteStatus,
  { bg: string; text: string; label: string }
> = {
  in: { bg: "bg-in-soft", text: "text-in", label: "in" },
  maybe: { bg: "bg-maybe-soft", text: "text-maybe", label: "maybe" },
  out: { bg: "bg-out-soft", text: "text-out", label: "out" },
};

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function formatVoteTime(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return TIME_FMT.format(d).replace(" ", "").toLowerCase();
}

export function VoterListDetail({
  planId,
  creatorId,
}: {
  planId: string;
  creatorId: string | null;
}) {
  const { voters } = useCircleVotes();
  const sorted = useMemo<Voter[]>(() => {
    const list = voters[planId] ?? [];
    return [...list].sort((a, b) => {
      const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (s !== 0) return s;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [voters, planId]);

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No votes yet — be the first to weigh in.
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {sorted.map((v, i) => {
        const isOrganizer = v.userId === creatorId;
        const time = formatVoteTime(v.votedAt);
        const pill = STATUS_PILL[v.status];
        return (
          <li
            key={v.userId}
            className={cn(
              "flex items-center gap-3 py-3",
              i !== sorted.length - 1 && "border-b border-ink/5",
            )}
          >
            {v.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={v.avatarUrl}
                alt=""
                className="size-8 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase">
                {v.displayName.slice(0, 1)}
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-ink">
                {v.displayName}
              </span>
              {isOrganizer ? (
                <span className="text-xs text-ink-muted">organizer</span>
              ) : null}
            </div>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.1em]",
                pill.bg,
                pill.text,
              )}
            >
              {pill.label}
              {time ? (
                <span className="font-normal normal-case tracking-normal opacity-70">
                  · {time}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
