"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Clock, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TimeProposalsProvider,
  useTimeProposals,
  type InitialProposalVoter,
  type ProposalMember,
  type ProposalRow,
} from "@/lib/realtime/use-time-proposals";
import { useMyHardCommitments } from "@/lib/use-hard-commitments";

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

function formatProposalTime(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: "", time: "" };
  return { day: DAY_FMT.format(d), time: TIME_FMT.format(d) };
}

type Props = {
  planId: string;
  initialProposals: ProposalRow[];
  initialVoters: InitialProposalVoter[];
  members: Record<string, ProposalMember>;
  currentUserId: string;
  canSuggest: boolean;
  // M32.4 — used to size the dot-check window per proposal row. Falls back
  // to the schema default (`plans.duration_minutes = 120`) if the caller
  // hasn't propagated it yet.
  planDurationMinutes?: number;
};

export function TimeProposals(props: Props) {
  return (
    <TimeProposalsProvider
      planId={props.planId}
      initialProposals={props.initialProposals}
      initialVoters={props.initialVoters}
      members={props.members}
      currentUserId={props.currentUserId}
    >
      <TimeProposalsInner
        planId={props.planId}
        canSuggest={props.canSuggest}
        planDurationMinutes={props.planDurationMinutes ?? 120}
      />
    </TimeProposalsProvider>
  );
}

function TimeProposalsInner({
  planId,
  canSuggest,
  planDurationMinutes,
}: {
  planId: string;
  canSuggest: boolean;
  planDurationMinutes: number;
}) {
  const {
    proposals,
    count,
    isMine,
    vote,
    totalVoters,
    topProposalId,
  } = useTimeProposals();

  // M32.4 — Scenario 5 visual (CONVERGENCE_PLAN.md §4.3). Sniff the proposal
  // window once per render and feed it into the shared hook so we don't
  // refetch on every row. Excluding `planId` keeps the current plan's own
  // canonical `starts_at` from painting a dot on a counter-proposal that
  // happens to match it (a degenerate but possible state).
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (proposals.length === 0) return { rangeStart: null, rangeEnd: null };
    const times = proposals
      .map((p) => new Date(p.startsAt).getTime())
      .filter((t) => !Number.isNaN(t));
    if (times.length === 0) return { rangeStart: null, rangeEnd: null };
    const padMs = planDurationMinutes * 60_000;
    return {
      rangeStart: new Date(Math.min(...times) - padMs),
      rangeEnd: new Date(Math.max(...times) + padMs * 2),
    };
  }, [proposals, planDurationMinutes]);
  const { findOverlap } = useMyHardCommitments(rangeStart, rangeEnd, planId);

  if (proposals.length === 0) {
    // No counter-proposals yet — render only the "+ Suggest another time"
    // affordance so the page can host this component even when nothing's
    // been counter-proposed.
    return canSuggest ? (
      <section className="flex flex-col gap-2 rounded-2xl bg-paper-card p-5 shadow-card">
        <span className="eyebrow text-ink-muted">
          When to?
        </span>
        <AddProposalRow />
      </section>
    ) : null;
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-paper-card p-5 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <span className="eyebrow text-ink-muted">
          When to?
        </span>
        {totalVoters > 0 ? (
          <span className="text-[11px] text-ink-muted">
            {totalVoters} {totalVoters === 1 ? "vote" : "votes"}
          </span>
        ) : null}
      </div>

      <ul role="list" className="flex flex-col gap-2">
        {proposals.map((p) => {
          const c = count(p.id);
          const mine = isMine(p.id);
          const isTop = topProposalId === p.id;
          const { day, time } = formatProposalTime(p.startsAt);
          const proposalStart = new Date(p.startsAt);
          const proposalEnd = new Date(
            proposalStart.getTime() + planDurationMinutes * 60_000,
          );
          const conflict = Number.isNaN(proposalStart.getTime())
            ? null
            : findOverlap(proposalStart, proposalEnd);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => vote(p.id)}
                aria-pressed={mine}
                aria-label={
                  conflict
                    ? `${time} ${day}, clashes with ${conflict.planTitle}`
                    : undefined
                }
                className={cn(
                  "relative flex w-full items-center gap-3 rounded-xl border bg-paper px-4 py-3 text-left transition-colors",
                  isTop
                    ? "border-coral bg-coral-soft"
                    : "border-ink/10 hover:border-ink/20",
                  mine && !isTop && "border-coral/60",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                {conflict ? (
                  <span
                    aria-hidden
                    title={`Clashes with ${conflict.planTitle}`}
                    className={cn(
                      "absolute right-2 top-2 size-1.5 rounded-full",
                      isTop ? "bg-white" : "bg-coral",
                    )}
                  />
                ) : null}
                <Clock
                  className={cn(
                    "size-4 shrink-0",
                    isTop ? "text-coral" : "text-ink-muted",
                  )}
                  aria-hidden
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-lg font-semibold leading-none text-ink">
                      {time}
                    </span>
                    <span className="text-xs text-ink-muted">{day}</span>
                  </div>
                  {p.proposerName ? (
                    <span className="text-[10px] text-ink-muted">
                      suggested by {p.proposerName}
                    </span>
                  ) : null}
                </div>
                {mine ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white"
                    aria-label="You voted for this"
                  >
                    <Check className="size-2.5" aria-hidden />
                    You
                  </span>
                ) : null}
                <span
                  className={cn(
                    "shrink-0 font-serif text-2xl font-semibold leading-none",
                    c === 0 && "opacity-40",
                    isTop ? "text-coral" : "text-ink",
                  )}
                >
                  {c}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {canSuggest ? <AddProposalRow /> : null}
    </section>
  );
}

function AddProposalRow() {
  const { add } = useTimeProposals();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          // Default the picker to "next round hour from now" so a fresh open
          // gives the user something sensible to nudge.
          if (!value) {
            const d = new Date();
            d.setMinutes(0, 0, 0);
            d.setHours(d.getHours() + 1);
            setValue(toLocal(d));
          }
        }}
        className="self-start text-xs font-medium text-coral transition-colors hover:text-coral/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
      >
        + Suggest another time
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Plus className="size-4 shrink-0 text-ink-muted" aria-hidden />
      <input
        type="datetime-local"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={pending}
        className="h-9 flex-1 min-w-[12rem] border-b border-ink/15 bg-transparent px-0 text-sm text-ink outline-none focus-visible:border-coral"
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending || !value}
        className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-paper-card transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setValue("");
        }}
        className="text-xs text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </div>
  );

  function submit() {
    if (!value) return;
    startTransition(async () => {
      try {
        await add(value);
        setValue("");
        setOpen(false);
      } catch {
        /* toast handled in hook */
      }
    });
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
