"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, ExternalLink, MapPin } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  getCompareSheetData,
  type CompareSheetData,
  type CompareSheetSide,
} from "@/lib/actions/conflicts";
import { castVote } from "@/lib/actions/votes";
import { formatPlanTime } from "@/lib/format-plan-time";
import { cn } from "@/lib/utils";

// M32.8 — `<ConflictCompareSheet />` (CONVERGENCE_PLAN.md §4.5). The
// destination for every conflict surface: the push notification (via
// `?conflictWith=…`), the calendar block, the lock-time strip, and the
// circle-internal collision banner. Same component, same data, three entry
// points.

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planAId: string;
  planBId: string;
  // Pre-loaded data path: plan-detail server-renders the sheet's data via
  // `getCompareSheetData` so the push-notification entry point doesn't
  // flash a spinner. Inline triggers (banner / strip) leave this null and
  // the sheet fetches on first open.
  initialData?: CompareSheetData | null;
};

export function ConflictCompareSheet({
  open,
  onOpenChange,
  planAId,
  planBId,
  initialData = null,
}: Props) {
  const [data, setData] = useState<CompareSheetData | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (data) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCompareSheetData(planAId, planBId)
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setError("Couldn't load both plans.");
        } else {
          setData(res);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError("Couldn't load both plans.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, data, planAId, planBId]);

  // Reset to the initial snapshot when the sheet closes so re-opening it
  // refreshes with the latest server state.
  useEffect(() => {
    if (open) return;
    setData(initialData);
    setError(null);
  }, [open, initialData]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86dvh] gap-3 overflow-y-auto rounded-[28px] border-ink/10 bg-paper-card p-4 shadow-[0_26px_70px_-36px_rgba(12,12,12,0.55)] sm:max-w-2xl sm:p-5">
        <DialogHeader className="gap-2 pr-7 text-left">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-coral-soft text-coral-strong">
              <AlertTriangle className="size-4" aria-hidden />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-coral-strong">
              Time conflict
            </span>
          </div>
          <DialogTitle className="font-serif text-[24px] leading-[1.05] text-ink">
            Choose where you&apos;ll be.
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-ink-muted">
            These plans overlap. Set one to maybe or decline the one you
            won&apos;t attend. You can still change your vote later.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-ink-muted">{error}</p>
        ) : loading || !data ? (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <SideSkeleton />
            <SideSkeleton />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <CompareCard
              side={data.a}
              onVoted={(newVote) =>
                setData((prev) =>
                  prev
                    ? { ...prev, a: { ...prev.a, myVote: newVote } }
                    : prev,
                )
              }
            />
            <CompareCard
              side={data.b}
              onVoted={(newVote) =>
                setData((prev) =>
                  prev
                    ? { ...prev, b: { ...prev.b, myVote: newVote } }
                    : prev,
                )
              }
            />
          </div>
        )}

        <DialogFooter className="pt-0 sm:justify-center">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="h-10 rounded-full px-5 text-sm font-semibold text-ink-muted hover:bg-ink/[0.06] hover:text-ink"
          >
            Decide later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SideSkeleton() {
  return (
    <div
      aria-hidden
      className="h-44 animate-pulse rounded-[22px] border border-ink/8 bg-paper"
    />
  );
}

function CompareCard({
  side,
  onVoted,
}: {
  side: CompareSheetSide;
  onVoted: (newVote: CompareSheetSide["myVote"]) => void;
}) {
  const timeLabel = side.isApproximate
    ? formatPlanTime(side.start, true, new Date(), side.timeZone)
    : formatPlanTime(side.start, false, new Date(), side.timeZone);
  const isIn = side.myVote === "in";
  return (
    <article
      className={cn(
        "flex flex-col gap-2 rounded-[22px] border bg-paper p-3 shadow-sm",
        isIn ? "border-in/25 ring-1 ring-in/10" : "border-ink/10",
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-full", side.circleColor)}
          />
          <span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            {side.circleName}
          </span>
        </div>
        <VoteChip status={side.myVote} />
      </header>

      <h3 className="font-serif text-[20px] font-semibold leading-tight text-ink">
        {side.planTitle}
      </h3>

      <div className="flex flex-col gap-1.5 text-[12px] text-ink-muted">
        <div className="flex items-center gap-1.5">
          <CalendarClock className="size-3.5 shrink-0" aria-hidden />
          <span>{timeLabel}</span>
        </div>
        {side.location ? (
          <div className="flex items-center gap-1.5">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{side.location}</span>
          </div>
        ) : null}
        <div className="text-[11px] font-medium">
          {side.inCount} in
          {side.maybeCount > 0 ? ` · ${side.maybeCount} maybe` : ""}
          {side.outCount > 0 ? ` · ${side.outCount} out` : ""}
        </div>
      </div>

      <CardActions side={side} onVoted={onVoted} />
    </article>
  );
}

function VoteChip({ status }: { status: CompareSheetSide["myVote"] }) {
  if (status === "in") {
    return (
      <span className="shrink-0 rounded-full bg-in-soft px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-in-strong">
        You&apos;re in
      </span>
    );
  }
  if (status === "maybe") {
    return (
      <span className="shrink-0 rounded-full bg-maybe-soft px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-maybe-strong">
        Maybe
      </span>
    );
  }
  if (status === "out") {
    return (
      <span className="shrink-0 rounded-full bg-out-soft px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-out">
        Out
      </span>
    );
  }
  return null;
}

function CardActions({
  side,
  onVoted,
}: {
  side: CompareSheetSide;
  onVoted: (newVote: CompareSheetSide["myVote"]) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const setVote = useCallback(
    (status: "maybe" | "out") => {
      if (isPending) return;
      // Optimistic — the sheet's own state updates immediately. If the
      // server action fails, we revert and surface a tiny error line.
      const previous = side.myVote;
      onVoted(status);
      startTransition(async () => {
        try {
          await castVote({ planId: side.planId, status });
          setErr(null);
        } catch {
          onVoted(previous);
          setErr("Couldn't save. Try again.");
        }
      });
    },
    [isPending, side.myVote, side.planId, onVoted],
  );

  // Sheet is meaningless once the plan is no longer alive — show a soft
  // status line instead of vote buttons.
  if (side.status === "done" || side.status === "cancelled") {
    return (
      <p className="text-[11px] text-ink-muted">
        This plan is {side.status}.
      </p>
    );
  }

  if (side.status === "confirmed") {
    return (
      <div className="mt-0.5 grid grid-cols-1 gap-2">
        {side.myVote !== "out" ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setVote("out")}
            className="h-9 rounded-2xl bg-out-soft px-3 text-[12px] font-bold text-out transition-colors hover:bg-out-soft/80 disabled:opacity-60"
          >
            Drop out
          </button>
        ) : (
          <p className="text-[11px] text-ink-muted">Locked. You&rsquo;re out.</p>
        )}
        <Link
          href={`/c/${side.circleSlug}/p/${side.planId}`}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-2xl border border-ink/10 bg-paper-card px-3 text-[12px] font-bold text-ink-muted transition-colors hover:text-ink"
        >
          Open details
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-0.5 grid grid-cols-2 gap-2">
      {side.myVote !== "maybe" ? (
        <button
          type="button"
          disabled={isPending}
          onClick={() => setVote("maybe")}
          className={cn(
            "h-9 rounded-2xl bg-maybe-soft px-3 text-[12px] font-bold text-maybe-strong transition-colors hover:bg-maybe-soft/80 disabled:opacity-60",
          )}
        >
          Maybe
        </button>
      ) : null}
      {side.myVote !== "out" ? (
        <button
          type="button"
          disabled={isPending}
          onClick={() => setVote("out")}
          className={cn(
            "h-9 rounded-2xl bg-out-soft px-3 text-[12px] font-bold text-out transition-colors hover:bg-out-soft/80 disabled:opacity-60",
          )}
        >
          I can&apos;t go
        </button>
      ) : null}
      <Link
        href={`/c/${side.circleSlug}/p/${side.planId}`}
        className="col-span-2 inline-flex h-9 items-center justify-center gap-1.5 rounded-2xl border border-ink/10 bg-paper-card px-3 text-[12px] font-bold text-ink-muted transition-colors hover:text-ink"
      >
        Open details
        <ExternalLink className="size-3" aria-hidden />
      </Link>
      {err ? (
        <p className="col-span-2 text-[11px] text-out">{err}</p>
      ) : null}
    </div>
  );
}

// Convenience wrapper — a button/link trigger that owns the sheet's open
// state. Used by the lock-time conflict strip and the circle-internal
// collision banner so they don't each reimplement the same useState.
export function CompareSheetTrigger({
  planAId,
  planBId,
  className,
  children,
  ariaLabel,
}: {
  planAId: string;
  planBId: string;
  className?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen(true)}
        className={className}
      >
        {children}
      </button>
      <ConflictCompareSheet
        open={open}
        onOpenChange={setOpen}
        planAId={planAId}
        planBId={planBId}
      />
    </>
  );
}
