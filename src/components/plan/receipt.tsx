"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { castVote, removeVote } from "@/lib/actions/votes";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";
import type { VoteStatus } from "@/lib/validation/vote";
import { VoteButtons } from "@/components/votes/vote-buttons";
import { offerShareImIn } from "./share-im-in";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import "./receipt-print.css";

function formatShortTime(date: Date, timeZone?: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

function formatReceiptDate(date: Date, timeZone?: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
}

const LOG_TIME = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export type ReceiptEvent = {
  id: string;
  kind:
    | "created"
    | "voted"
    | "proposed_time"
    | "proposed_venue"
    | "added_member"
    | "locked"
    | "cancelled"
    | "suggestion_added"
    | "suggestion_rejected";
  actorName: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type ReceiptAddition = {
  id: string;
  label: string | null;
  startsAt: string;
};

type Props = {
  planId: string;
  planTitle: string;
  startsAt: Date;
  timeZone?: string;
  location: string | null;
  // Used by the post-commit share affordance to build the share URL.
  // Optional for back-compat — share toast is suppressed when absent.
  circleSlug?: string;
  recipientCount: number;
  inCount: number; // server-rendered seed for "RVD x of y"
  status: "confirmed" | "done" | "cancelled";
  // Fix 3 — when true, the vote buttons are replaced with a muted
  // "You were In/Maybe/Out" label (or hidden if the user never voted).
  // Past plans never offer vote changes.
  isPast?: boolean;
  additions: ReceiptAddition[];
  events: ReceiptEvent[];
  // Slot for "+ Suggest add-on" — composed by the page.
  suggestAddOnSlot?: React.ReactNode;
  // M25 — Maps + calendar deep-links cluster, composed server-side so the
  // maps URL can pick Apple vs. Google by UA.
  deepLinksSlot?: React.ReactNode;
};

export function Receipt({
  planId,
  planTitle,
  startsAt,
  timeZone,
  location,
  circleSlug,
  recipientCount,
  inCount: seedInCount,
  status,
  isPast = false,
  additions,
  events,
  suggestAddOnSlot,
  deepLinksSlot,
}: Props) {
  const {
    voters,
    currentUser,
    setOptimisticVote,
    clearOptimisticVote,
  } = useCircleVotes();
  const planVoters = useMemo(
    () => voters[planId] ?? [],
    [voters, planId],
  );

  // Even after lock, voters can drop ("flip to out"). The numerator updates
  // live so the receipt reflects the current truth, not a frozen snapshot.
  const liveInCount = useMemo(() => {
    if (planVoters.length === 0) return seedInCount;
    let n = 0;
    for (const v of planVoters) if (v.status === "in") n += 1;
    return n;
  }, [planVoters, seedInCount]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const ownVote: VoteStatus | null =
    planVoters.find((v) => v.userId === currentUser.id)?.status ?? null;

  const onVote = (next: VoteStatus | null) => {
    setOptimisticVote(planId, next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void (async () => {
        try {
          if (next === null) await removeVote({ planId });
          else await castVote({ planId, status: next });
          // Same post-In affordance the feed-card uses. Helper dedupes
          // per session so refreshing the receipt doesn't re-prompt.
          if (next === "in" && circleSlug) {
            offerShareImIn({
              planId,
              title: planTitle,
              startsAt,
              circleSlug,
              timeZone,
            });
          }
        } catch (err) {
          clearOptimisticVote(planId);
          toast.error(
            err instanceof Error ? err.message : "Couldn't save vote.",
          );
        }
      })();
    }, 200);
  };

  const dateLabel = formatReceiptDate(startsAt, timeZone).toUpperCase();
  const timeLabel = formatShortTime(startsAt, timeZone);
  const afterRow = additions[0] ?? null;
  const shortId = shortReceiptId(planId);
  const showStamp = status === "confirmed" || status === "cancelled";
  const stampLabel = status === "cancelled" ? "CANCELLED" : "LOCKED";

  // Lock-moment "print-in" — fires once per (plan × tab session) when the
  // user lands on a freshly-confirmed plan. Guarded by sessionStorage so
  // refreshes don't replay it. Skipped on cancelled (the stamp already
  // conveys the state; a celebratory animation would be tone-deaf).
  const [shouldPrintIn, setShouldPrintIn] = useState(false);
  useEffect(() => {
    if (status !== "confirmed") return;
    if (typeof window === "undefined") return;
    const key = `squad.receipt.printed.${planId}`;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
    setShouldPrintIn(true);
  }, [status, planId]);

  return (
    <article
      className={
        "plan-receipt rounded-2xl border border-ink-subtle bg-paper-elevated px-6 pt-6 pb-8 text-ink shadow-card-raised " +
        (shouldPrintIn ? "animate-receipt-print" : "")
      }
    >
      <p className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-muted">
        Receipt · #{shortId}
      </p>

      <header className="relative mt-3 flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 className="font-serif text-3xl font-semibold leading-none text-ink">
            The Plan
          </h2>
          <span className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
            {dateLabel}
          </span>
        </div>
        {showStamp ? (
          <span
            aria-label={`Plan ${stampLabel.toLowerCase()}`}
            className={
              "select-none rounded-md border-2 border-dashed px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] " +
              (status === "cancelled"
                ? "border-out text-out"
                : "border-in-strong text-in-strong")
            }
            style={{ transform: "rotate(-6deg)" }}
          >
            {stampLabel}
          </span>
        ) : null}
      </header>

      <dl className="receipt-rows mt-5 flex flex-col gap-2 border-y border-dashed border-ink/25 py-4 font-mono text-sm">
        <ReceiptRow label="When" value={timeLabel} />
        <ReceiptRow label="Where" value={location ?? "—"} />
        {afterRow ? (
          <ReceiptRow
            label="After"
            value={
              afterRow.label
                ? `${afterRow.label} · ${formatShortTime(
                    new Date(afterRow.startsAt),
                    timeZone,
                  )}`
                : formatShortTime(new Date(afterRow.startsAt), timeZone)
            }
          />
        ) : null}
        <ReceiptRow
          label="Who"
          value={`${liveInCount} of ${recipientCount}`}
        />
      </dl>

      {deepLinksSlot ? <div className="pt-4">{deepLinksSlot}</div> : null}
      {suggestAddOnSlot ? <div className="pt-3">{suggestAddOnSlot}</div> : null}

      <EditsSection events={events} timeZone={timeZone} />

      <section className="mt-6 flex flex-col gap-3 border-t border-dashed border-ink/25 pt-5">
        <div className="flex items-center justify-between">
          <span className="eyebrow text-ink-muted">RSVP</span>
          <span className="eyebrow text-ink">
            {ownVote === "in"
              ? "You're in"
              : ownVote === "maybe"
                ? "You're maybe"
                : ownVote === "out"
                  ? "You're out"
                  : statusLabel(status)}
          </span>
        </div>
        <p className="text-center eyebrow text-ink-muted">
          {planTitle}
        </p>
        {/* Past plans never show vote UI — surface the user's historical
            vote as a muted "You were X" label.
            Cancelled plans never show vote UI either — the stamp already
            communicates the state and a "drop out" affordance on a
            cancelled plan would be incoherent.
            Confirmed (locked) plans replace the In/Maybe/Out trio with a
            quiet "I can't make it anymore" link for the user who's
            currently in — preserves the drop-out path without showing
            the trio when the decision is settled.
            Active is never reached here since the page renders the
            live-ticker, not the receipt, for active plans. */}
        {isPast ? (
          ownVote ? (
            <p className="no-print text-center text-xs text-ink-muted">
              You were{" "}
              <span className="font-semibold capitalize">{ownVote}</span>.
            </p>
          ) : null
        ) : status === "cancelled" ? null : status === "confirmed" ? (
          ownVote === "in" ? (
            <DropOutLink
              planTitle={planTitle}
              onConfirm={() => onVote("out")}
            />
          ) : null
        ) : (
          <div className="no-print">
            <VoteButtons selected={ownVote} onChange={onVote} size="default" />
          </div>
        )}
      </section>
    </article>
  );
}

// Drop-out link shown beneath the RSVP eyebrow on locked plans. Hidden
// for users who aren't currently "in" (nothing to drop) and on cancelled
// plans (the stamp speaks for itself). Confirms before firing so a stray
// tap doesn't bail on the squad.
function DropOutLink({
  planTitle,
  onConfirm,
}: {
  planTitle: string;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="no-print flex justify-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-ink-muted underline-offset-2 hover:text-out-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          I can&rsquo;t make it anymore
        </button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Drop out of {planTitle}?</DialogTitle>
            <DialogDescription>
              Your RSVP flips to <span className="font-semibold">out</span>.
              The squad sees the update; the plan stays locked.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Never mind
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onConfirm();
                setOpen(false);
              }}
            >
              I&rsquo;m out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Events list — collapses to the 5 most-recent when there are more than 5
// total, with a "Show N earlier edits" toggle. Keeps the receipt readable
// on long-lived plans without losing the audit trail.
const EDITS_COLLAPSE_THRESHOLD = 5;

function EditsSection({
  events,
  timeZone,
}: {
  events: ReceiptEvent[];
  timeZone?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = events.length;
  const overflow = total > EDITS_COLLAPSE_THRESHOLD;
  // Most-recent N stay visible by default. Events arrive newest-last from
  // the server query (asc), so we slice from the end and reverse for the
  // chronological-bottom display order — except no, the current rendering
  // is in raw order; we'll keep the same order and slice the LAST N.
  const visible =
    expanded || !overflow ? events : events.slice(total - EDITS_COLLAPSE_THRESHOLD);
  const hiddenCount = total - visible.length;

  return (
    <section className="pt-5">
      <p className="pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
        Edits
      </p>
      {total === 0 ? (
        <p className="font-mono text-xs italic text-ink-muted">
          No activity recorded.
        </p>
      ) : (
        <>
          {overflow && !expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="no-print mb-2 inline-flex items-center gap-1 font-mono text-[11px] text-coral-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
            >
              Show {hiddenCount} earlier {hiddenCount === 1 ? "edit" : "edits"}
            </button>
          ) : null}
          <ul className="flex flex-col gap-1.5 font-mono text-xs leading-relaxed text-ink/80">
            {visible.map((e) => (
              <li
                key={e.id}
                className="grid grid-cols-[56px_minmax(0,1fr)] items-baseline gap-3"
              >
                <span className="shrink-0 tabular-nums text-ink-muted">
                  {LOG_TIME.format(new Date(e.createdAt))}
                </span>
                <span className="min-w-0">
                  {describeEvent(e, timeZone)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function shortReceiptId(planId: string): string {
  // Deterministic 4-digit short code derived from the plan UUID's first
  // 8 hex chars. Range 1000–9999 so the receipt header always reads as a
  // 4-digit number — matches the mock's "#4421". Pure presentation —
  // never used as a lookup key.
  const head = planId.replace(/-/g, "").slice(0, 8);
  const n = parseInt(head, 16);
  if (!Number.isFinite(n)) return "0000";
  return String((n % 9000) + 1000);
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="eyebrow-sm text-ink-muted">
        {label}
      </dt>
      <dd className="truncate text-right text-ink">{value}</dd>
    </div>
  );
}

function statusLabel(s: "confirmed" | "done" | "cancelled"): string {
  if (s === "confirmed") return "Locked";
  if (s === "done") return "Done";
  return "Cancelled";
}

function describeEvent(e: ReceiptEvent, timeZone?: string): string {
  const who = e.actorName ?? "Someone";
  switch (e.kind) {
    case "created":
      return `${who} started the plan`;
    case "voted": {
      const vote = (e.payload?.vote as string | undefined) ?? "voted";
      return `${who} voted ${vote}`;
    }
    case "proposed_time": {
      const kind = (e.payload?.kind as string | undefined) ?? "replacement";
      const label = e.payload?.label as string | undefined;
      const startsAt = e.payload?.startsAt as string | undefined;
      const time = startsAt
        ? formatShortTime(new Date(startsAt), timeZone).toLowerCase()
        : "a new time";
      if (kind === "addition") {
        return `${who} added "${label ?? "add-on"}" at ${time}`;
      }
      return `${who} proposed ${time}`;
    }
    case "proposed_venue": {
      const label = (e.payload?.label as string | undefined) ?? "a venue";
      return `${who} suggested ${label}`;
    }
    case "added_member": {
      return `${who} added a member`;
    }
    case "locked":
      return `Plan locked`;
    case "cancelled":
      return `${who} cancelled`;
    case "suggestion_added":
      return `${who} added a suggestion`;
    case "suggestion_rejected":
      return `${who} dismissed a suggestion`;
    default:
      return who;
  }
}
