"use client";

import { useState, useTransition } from "react";
import { Plus, MapPin, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  VenueVotesProvider,
  useVenueVotes,
  type InitialVenueVoter,
  type VenueMember,
  type VenueRow,
} from "@/lib/realtime/use-venue-votes";

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
  const { venues, count, isMine, vote, totalVoters, topVenueId, pending } =
    useVenueVotes();

  if (venues.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-paper-card p-5 shadow-[0_1px_2px_rgba(20,15,10,0.04),0_8px_24px_-12px_rgba(20,15,10,0.10)]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
          Where to?
        </span>
        {totalVoters > 0 ? (
          <span className="text-[11px] text-ink-muted">
            {totalVoters} {totalVoters === 1 ? "vote" : "votes"}
          </span>
        ) : null}
      </div>

      <ul
        role="list"
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 sm:grid sm:grid-flow-col sm:auto-cols-fr sm:overflow-visible sm:pb-0"
      >
        {venues.map((v) => {
          const c = count(v.id);
          const mine = isMine(v.id);
          const isTop = topVenueId === v.id;
          return (
            <li
              key={v.id}
              className="min-w-[70%] shrink-0 snap-start sm:min-w-0"
            >
              <button
                type="button"
                onClick={() => vote(v.id)}
                disabled={pending}
                aria-pressed={mine}
                className={cn(
                  "flex h-full w-full flex-col items-start gap-2 rounded-xl border bg-paper px-4 py-3 text-left transition-colors",
                  isTop
                    ? "border-coral bg-coral-soft"
                    : "border-ink/10 hover:border-ink/20",
                  mine && !isTop && "border-coral/60",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <MapPin
                      className={cn(
                        "size-4 shrink-0",
                        isTop ? "text-coral" : "text-ink-muted",
                      )}
                      aria-hidden
                    />
                    <span className="truncate text-sm font-medium text-ink">
                      {v.label}
                    </span>
                  </div>
                  {mine ? (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-paper-card"
                      aria-label="You voted for this"
                    >
                      <Check className="size-2.5" aria-hidden />
                      You
                    </span>
                  ) : null}
                </div>
                <div className="flex w-full items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "font-serif text-2xl font-semibold leading-none",
                      c === 0 && "opacity-40",
                      isTop ? "text-coral" : "text-ink",
                    )}
                  >
                    {c}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-ink-muted">
                    {c === 1 ? "vote" : "votes"}
                  </span>
                </div>
                {v.suggesterName ? (
                  <span className="text-[10px] text-ink-muted">
                    suggested by {v.suggesterName}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {canSuggest ? <AddVenueRow /> : null}
    </section>
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
