"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, X } from "lucide-react";
import { toast } from "sonner";
import { cancelPlan, confirmPlan } from "@/lib/actions/plans";
import { castVote, removeVote } from "@/lib/actions/votes";
import { useCircleVotes } from "@/lib/realtime/use-circle-votes";
import type { VoteStatus } from "@/lib/validation/vote";
import { VoteSpectrumBar } from "@/components/votes/vote-spectrum-bar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const COMMIT_DEBOUNCE_MS = 200;

function formatShortTime(date: Date, timeZone?: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

export type LiveTickerAddition = {
  id: string;
  label: string | null;
  startsAt: string;
  proposerName: string | null;
  createdAt: string;
};

type Props = {
  planId: string;
  planTitle: string;
  startsAt: Date;
  timeZone?: string;
  location: string | null;
  decideBy: Date | null;
  recipientCount: number;
  lockThreshold: number;
  // Subset of plan_time_proposals where kind = 'addition'.
  additions: LiveTickerAddition[];
  // Earlier replacement that won so far — surfaced as a "moved 7:45 → 8:30"
  // hint under the canonical time. Null when no replacement has shifted it.
  shiftedFromTime: Date | null;
  now: Date;
  // Slot for the "+ Suggest add-on" affordance — composed by the page so
  // the dark CSS-vars context applies. May be null when the user can't
  // suggest (locked plan, non-recipient).
  suggestAddOnSlot?: React.ReactNode;
  // M22 — creators + admins can surface Cancel / Mark-as-set as inline
  // buttons at the bottom of the ticker so they're reachable without
  // diving into the `···` overflow. Same server actions; just a quicker
  // affordance during the live decision window.
  canManage?: boolean;
  circleSlug?: string;
};

export function LiveTicker({
  planId,
  planTitle,
  startsAt,
  timeZone,
  location,
  decideBy,
  recipientCount,
  lockThreshold,
  additions,
  shiftedFromTime,
  now: serverNow,
  suggestAddOnSlot,
  canManage = false,
  circleSlug,
}: Props) {
  const router = useRouter();
  const [openConfirm, setOpenConfirm] = useState<"cancel" | "set" | null>(null);
  const [, startActionTransition] = useTransition();
  const { voters, currentUser } = useCircleVotes();
  const planVoters = useMemo(
    () => voters[planId] ?? [],
    [voters, planId],
  );

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

  const inCount = useMemo(() => {
    let n = 0;
    for (const v of planVoters) {
      if (v.userId === currentUser.id) continue;
      if (v.status === "in") n += 1;
    }
    if (pendingVote === "in") return n + 1;
    if (pendingVote === undefined) {
      const own = planVoters.find((v) => v.userId === currentUser.id);
      if (own?.status === "in") return n + 1;
    }
    return n;
  }, [planVoters, pendingVote, currentUser.id]);

  // Countdown: refresh every 10s so the header reads accurately without
  // hammering renders. Clamps at 0.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!decideBy) return;
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, [decideBy]);
  const remainingLabel = useMemo(() => {
    if (!decideBy) return null;
    const ms = decideBy.getTime() - (serverNow.getTime() + tick * 10_000);
    if (ms <= 0) return "Locking now";
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [decideBy, serverNow, tick]);

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
    }, COMMIT_DEBOUNCE_MS);
  };

  const isIn = ownVote === "in";
  const ctaLabel = isIn ? "You're in" : "I'm in";
  // Show the deadline only when it's actually set and in the future. Without
  // a decideBy, the plan only locks via vote threshold — showing startsAt
  // here implies the plan auto-locks at start time, which it doesn't.
  const deadlineLabel =
    decideBy && decideBy.getTime() > serverNow.getTime()
      ? formatShortTime(decideBy, timeZone)
      : null;
  const lockFooter = deadlineLabel
    ? `Locks at ${deadlineLabel}, or sooner with ${lockThreshold}+ in`
    : `Locks when ${lockThreshold}+ are in`;

  return (
    <div
      // Self-contained dark theme: inverts paper/ink CSS vars within this
      // node only. The rest of the page (header, comments, Squad section)
      // continues to use the page-level light palette.
      className="relative flex flex-col gap-6 rounded-2xl bg-[#0e0e0e] px-6 py-7 text-white shadow-[0_24px_48px_-24px_rgba(0,0,0,0.5)]"
      style={
        {
          ["--paper" as string]: "#0e0e0e",
          ["--paper-card" as string]: "#1a1a1a",
          ["--ink" as string]: "#fafafa",
          ["--ink-muted" as string]: "#a3a3a3",
        } as React.CSSProperties
      }
    >
      <div className="flex items-center justify-between gap-3">
        {remainingLabel ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-coral/15 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-coral">
            <span
              aria-hidden
              className="size-1.5 animate-pulse rounded-full bg-coral"
            />
            Lock · {remainingLabel}
          </span>
        ) : (
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
            Deciding now
          </span>
        )}
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
          {recipientCount}{" "}
          {recipientCount === 1 ? "person" : "people"}
        </span>
      </div>

      <h1 className="font-serif text-[34px] leading-[1.05] font-semibold text-white">
        {planTitle}.
      </h1>

      <div className="flex items-baseline gap-2">
        <span className="font-serif text-7xl font-semibold tabular-nums text-in">
          {inCount}
        </span>
        <span className="font-serif text-2xl text-white/40">
          / {recipientCount}
        </span>
        <span className="ml-1 text-base font-medium text-white/60">in</span>
      </div>

      <VoteSpectrumBar planId={planId} tone="dark" />

      <dl className="flex flex-col gap-3 border-t border-white/10 pt-4">
        <Row
          label="When"
          value={formatShortTime(startsAt, timeZone)}
          hint={
            shiftedFromTime
              ? `moved ${formatShortTime(shiftedFromTime, timeZone).toLowerCase()} → ${formatShortTime(
                  startsAt,
                  timeZone,
                ).toLowerCase()}`
              : null
          }
        />
        <Row label="Where" value={location ?? "TBD"} />
        {additions.length > 0 ? (
          additions.map((a) => (
            <Row
              key={a.id}
              label="Plus"
              value={
                a.label
                  ? `${a.label} at ${formatShortTime(
                      new Date(a.startsAt),
                      timeZone,
                    )}`
                  : `Add-on at ${formatShortTime(
                      new Date(a.startsAt),
                      timeZone,
                    )}`
              }
              hint={
                a.proposerName
                  ? `proposed by ${a.proposerName}`
                  : "proposed"
              }
            />
          ))
        ) : null}
        {suggestAddOnSlot ? (
          <div className="pt-1">{suggestAddOnSlot}</div>
        ) : null}
      </dl>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => onVote(isIn ? null : "in")}
          className={cn(
            "h-12 flex-1 rounded-full font-semibold transition-all duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-in",
            isIn
              ? "bg-in text-[#0e0e0e]"
              : "bg-in/20 text-in hover:bg-in/30",
          )}
          aria-pressed={isIn}
        >
          {ctaLabel}
        </button>
        {isIn ? (
          <button
            type="button"
            onClick={() => onVote(null)}
            className="h-12 rounded-full border border-white/20 px-5 text-sm font-medium text-white/80 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            Change
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onVote(ownVote === "maybe" ? null : "maybe")}
              className={cn(
                "h-12 rounded-full px-5 text-sm font-medium transition-colors",
                ownVote === "maybe"
                  ? "bg-maybe text-[#0e0e0e]"
                  : "border border-white/15 text-white/80 hover:bg-white/5",
              )}
              aria-pressed={ownVote === "maybe"}
            >
              Maybe
            </button>
            <button
              type="button"
              onClick={() => onVote(ownVote === "out" ? null : "out")}
              className={cn(
                "h-12 rounded-full px-5 text-sm font-medium transition-colors",
                ownVote === "out"
                  ? "bg-out text-white"
                  : "border border-white/15 text-white/80 hover:bg-white/5",
              )}
              aria-pressed={ownVote === "out"}
            >
              Out
            </button>
          </>
        )}
      </div>

      <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
        {lockFooter}
      </p>

      {canManage ? (
        <div className="-mx-2 flex items-center gap-3 border-t border-white/10 pt-4">
          <button
            type="button"
            onClick={() => setOpenConfirm("cancel")}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full border border-out/40 px-4 text-sm font-semibold text-out transition-colors hover:bg-out/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-out/60"
          >
            <X className="size-4" aria-hidden />
            Cancel
          </button>
          <button
            type="button"
            onClick={() => setOpenConfirm("set")}
            className="flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-full bg-in px-4 text-sm font-semibold text-[#0e0e0e] transition-colors hover:bg-in/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-in"
          >
            <Lock className="size-4" aria-hidden />
            Mark as set
          </button>
        </div>
      ) : null}

      <Dialog
        open={openConfirm !== null}
        onOpenChange={(o) => !o && setOpenConfirm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {openConfirm === "cancel"
                ? "Cancel this plan?"
                : "Lock the plan now?"}
            </DialogTitle>
            <DialogDescription>
              {openConfirm === "cancel"
                ? "Everyone in the squad will be notified. The plan card stays visible for a day, struck through, before it disappears."
                : `Locks the plan at ${formatShortTime(startsAt, timeZone)}${
                    location ? ` · ${location}` : ""
                  }. The squad gets an "It's happening" notification.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <DialogClose asChild>
              <button
                type="button"
                className="h-10 rounded-full border border-ink/15 px-4 text-sm font-medium text-ink hover:bg-paper-card"
              >
                Not yet
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={() => {
                const kind = openConfirm;
                if (!kind) return;
                setOpenConfirm(null);
                if (kind === "cancel" && circleSlug) {
                  router.push(`/c/${circleSlug}`);
                }
                startActionTransition(async () => {
                  try {
                    if (kind === "cancel") await cancelPlan({ planId });
                    else await confirmPlan({ planId });
                    router.refresh();
                  } catch (err) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : "Couldn't update plan.",
                    );
                  }
                });
              }}
              className={cn(
                "h-10 rounded-full px-4 text-sm font-semibold text-white",
                openConfirm === "cancel"
                  ? "bg-out hover:bg-out/90"
                  : "bg-in hover:bg-in/90",
              )}
            >
              {openConfirm === "cancel" ? "Cancel plan" : "Lock it"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div className="grid grid-cols-[64px_1fr] items-baseline gap-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
        {label}
      </dt>
      <dd className="flex flex-col">
        <span className="text-base text-white">{value}</span>
        {hint ? (
          <span className="text-xs text-white/45">{hint}</span>
        ) : null}
      </dd>
    </div>
  );
}
