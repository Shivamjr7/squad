"use client";

import { useState, useTransition } from "react";
import { Plus, MapPin, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { GradientAvatar } from "@/components/ui/gradient-avatar";
import {
  VenueVotesProvider,
  useVenueVotes,
  type InitialVenueVoter,
  type VenueMember,
  type VenueRow,
} from "@/lib/realtime/use-venue-votes";

const AVATAR_STACK_LIMIT = 3;

type Props = {
  planId: string;
  initialVenues: VenueRow[];
  initialVoters: InitialVenueVoter[];
  members: Record<string, VenueMember>;
  currentUserId: string;
  canSuggest: boolean;
};

export function VenueVote(props: Props) {
  return (
    <VenueVotesProvider
      planId={props.planId}
      initialVenues={props.initialVenues}
      initialVoters={props.initialVoters}
      members={props.members}
      currentUserId={props.currentUserId}
    >
      <VenueVoteInner canSuggest={props.canSuggest} />
    </VenueVotesProvider>
  );
}

function VenueVoteInner({ canSuggest }: { canSuggest: boolean }) {
  const { venues, count, isMine, vote, totalVoters, topVenueId, votersFor } =
    useVenueVotes();

  if (venues.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-paper-card p-5 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <span className="eyebrow text-ink-muted">Where to?</span>
        {totalVoters > 0 ? (
          <span className="text-[11px] text-ink-muted">
            {totalVoters} {totalVoters === 1 ? "vote" : "votes"}
          </span>
        ) : (
          <span className="text-[11px] text-ink-muted">Tap to vote</span>
        )}
      </div>

      <ul role="list" className="flex flex-col gap-2">
        {venues.map((v) => {
          const c = count(v.id);
          const mine = isMine(v.id);
          const isTop = topVenueId === v.id && c > 0;
          const voters = votersFor(v.id);
          return (
            <li key={v.id}>
              <VenueRow
                label={v.label}
                suggesterName={v.suggesterName}
                count={c}
                mine={mine}
                isTop={isTop}
                voters={voters}
                onClick={() => vote(v.id)}
              />
            </li>
          );
        })}
      </ul>

      {canSuggest ? <AddVenueRow /> : null}
    </section>
  );
}

function VenueRow({
  label,
  suggesterName,
  count,
  mine,
  isTop,
  voters,
  onClick,
}: {
  label: string;
  suggesterName: string | null;
  count: number;
  mine: boolean;
  isTop: boolean;
  voters: VenueMember[];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={mine}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral",
        mine
          ? "border-coral bg-coral-soft"
          : isTop
            ? "border-coral/40 bg-coral-soft/40 hover:bg-coral-soft/60"
            : "border-ink/10 bg-paper hover:border-ink/20",
      )}
    >
      {/* Leading radio-like indicator — fills coral when voted. Replaces the
          oversized serif number that dominated the old card. */}
      <span
        aria-hidden
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors",
          mine
            ? "border-coral bg-coral text-white"
            : "border-ink/20 bg-paper text-transparent",
        )}
      >
        <Check className="size-3.5" strokeWidth={2.5} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5">
          <MapPin
            className={cn(
              "size-3.5 shrink-0",
              isTop ? "text-coral" : "text-ink-muted",
            )}
            aria-hidden
          />
          <span className="line-clamp-2 text-[14px] font-semibold leading-snug text-ink">
            {label}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-muted">
          {isTop ? (
            <span className="rounded-full bg-coral/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-coral">
              Leading
            </span>
          ) : null}
          {suggesterName ? <span>by {suggesterName}</span> : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {voters.length > 0 ? (
          <div className="flex -space-x-1.5">
            {voters.slice(0, AVATAR_STACK_LIMIT).map((voter) => (
              <GradientAvatar
                key={voter.userId}
                seed={voter.userId}
                name={voter.displayName}
                src={voter.avatarUrl}
                size="xs"
                className="ring-2 ring-paper-card"
              />
            ))}
          </div>
        ) : null}
        {voters.length > AVATAR_STACK_LIMIT ? (
          <span className="text-[11px] font-semibold text-ink-muted tabular-nums">
            +{voters.length - AVATAR_STACK_LIMIT}
          </span>
        ) : null}
        <span
          className={cn(
            "min-w-[1.25rem] text-right text-[15px] font-bold tabular-nums",
            count === 0 ? "text-ink-muted/60" : "text-ink",
          )}
          aria-label={`${count} ${count === 1 ? "vote" : "votes"}`}
        >
          {count}
        </span>
      </div>
    </button>
  );
}

function AddVenueRow() {
  const { add } = useVenueVotes();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-xs font-medium text-coral transition-colors hover:text-coral/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
      >
        + Suggest another venue
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 pt-1">
      <Plus className="size-4 shrink-0 text-ink-muted" aria-hidden />
      <input
        type="text"
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Bar Tartine"
        maxLength={100}
        disabled={pending}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            setOpen(false);
            setLabel("");
          }
        }}
        className="h-9 flex-1 border-b border-ink/15 bg-transparent px-0 text-sm text-ink outline-none focus-visible:border-coral"
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending || label.trim().length === 0}
        className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-paper-card transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setLabel("");
        }}
        className="text-xs text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </div>
  );

  function submit() {
    const trimmed = label.trim();
    if (trimmed.length === 0) return;
    startTransition(async () => {
      try {
        await add(trimmed);
        setLabel("");
        setOpen(false);
      } catch {
        // toast handled in the hook
      }
    });
  }
}
