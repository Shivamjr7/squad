"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { castVote, removeVote } from "@/lib/actions/votes";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";
import type { VoteStatus } from "@/lib/validation/vote";
import { VoteButtons } from "@/components/votes/vote-buttons";
import "./receipt-print.css";

function formatShortTime(date: Date, timeZone?: string) {
  return new Intl.DateTimeFormat(undefined, {
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

const LOG_TIME = new Intl.DateTimeFormat(undefined, {
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
  recipientCount,
  inCount: seedInCount,
  status,
  isPast = false,
  additions,
  events,
  suggestAddOnSlot,
  deepLinksSlot,
}: Props) {
  const { voters, currentUser } = useCircleVotes();
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

  const [pendingVote, setPendingVote] = useState<
    VoteStatus | null | undefined
  >(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pendingVote === undefined) return;
    const canonical =
      planVoters.find((v) => v.userId === currentUser.id)?.status ?? null;
    if (canonical === pendingVote) setPendingVote(undefined);
  }, [planVoters, pendingVote, currentUser.id]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const ownVote: VoteStatus | null =
    pendingVote !== undefined
      ? pendingVote
      : (planVoters.find((v) => v.userId === currentUser.id)?.status ?? null);

  const onVote = (next: VoteStatus | null) => {
    setPendingVote(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void (async () => {
        try {
          if (next === null) await removeVote({ planId });
          else await castVote({ planId, status: next });
        } catch (err) {
          setPendingVote(undefined);
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

  return (
    <article
      className="plan-receipt rounded-2xl border border-ink-subtle bg-paper-elevated px-6 pt-7 pb-8 text-ink shadow-card-raised"
    >
      <header className="flex flex-col items-center gap-1 pb-5 text-center">
        <h2 className="font-serif text-3xl font-semibold text-ink">
          The Plan
        </h2>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted">
          {dateLabel} · {timeLabel}
        </p>
      </header>

      <dl className="receipt-rows flex flex-col gap-2 border-y border-dashed border-ink/25 py-4 font-mono text-sm">
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
          label="RVD"
          value={`${liveInCount} of ${recipientCount}`}
        />
      </dl>

      {deepLinksSlot ? <div className="pt-4">{deepLinksSlot}</div> : null}
      {suggestAddOnSlot ? <div className="pt-3">{suggestAddOnSlot}</div> : null}

      <section className="flex flex-col gap-1.5 pt-5 font-mono text-xs leading-relaxed text-ink/80">
        {events.length === 0 ? (
          <p className="italic text-ink-muted">No activity recorded.</p>
        ) : (
          events.map((e) => (
            <p key={e.id} className="flex gap-2">
              <span className="shrink-0 tabular-nums text-ink-muted">
                {LOG_TIME.format(new Date(e.createdAt))}
              </span>
              <span className="min-w-0 flex-1">
                {describeEvent(e, timeZone)}
              </span>
            </p>
          ))
        )}
      </section>

      <section className="mt-6 flex flex-col gap-3 border-t border-dashed border-ink/25 pt-5">
        <div className="flex items-center justify-between">
          <span className="eyebrow text-ink-muted">
            Status
          </span>
          <span className="eyebrow text-ink">
            {statusLabel(status)}
          </span>
        </div>
        <p className="text-center eyebrow text-ink-muted">
          {planTitle}
        </p>
        {/* Past plans never show vote UI — effectiveStatus check (Fix 3).
            For users who voted before the plan slipped past, surface their
            historical vote as a muted "You were X" label. Otherwise show
            the live vote buttons. */}
        {isPast ? (
          ownVote ? (
            <p className="no-print text-center text-xs text-ink-muted">
              You were{" "}
              <span className="font-semibold capitalize">{ownVote}</span>.
            </p>
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
