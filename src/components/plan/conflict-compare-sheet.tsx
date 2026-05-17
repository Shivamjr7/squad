"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, ExternalLink, MapPin } from "lucide-react";
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
      <DialogContent className="gap-3 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            Two plans, same time.
          </DialogTitle>
          <DialogDescription>
            Pick the one you&apos;ll be at. You can always change your mind
            later.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-ink-muted">{error}</p>
        ) : loading || !data ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SideSkeleton />
            <SideSkeleton />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="sm:order-1"
          >
            Keep both
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
      className="h-44 animate-pulse rounded-xl border border-ink/5 bg-paper-card"
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
    ? formatPlanTime(side.start, true, new Date())
    : formatPlanTime(side.start, false, new Date());
  return (
    <article className="flex flex-col gap-2.5 rounded-xl border border-ink/10 bg-paper-card p-3">
      <header className="flex items-baseline justify-between gap-2">
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

      <h3 className="font-serif text-lg leading-tight text-ink">
        {side.planTitle}
      </h3>

      <div className="flex flex-col gap-1.5 text-xs text-ink-muted">
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
        <div className="text-[11px]">
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
      <span className="shrink-0 rounded-full bg-in/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-in-strong">
        You&apos;re in
      </span>
    );
  }
  if (status === "maybe") {
    return (
      <span className="shrink-0 rounded-full bg-maybe/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-maybe">
        Maybe
      </span>
    );
  }
  if (status === "out") {
    return (
      <span className="shrink-0 rounded-full bg-out/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-out">
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

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {side.myVote !== "maybe" ? (
        <button
          type="button"
          disabled={isPending}
          onClick={() => setVote("maybe")}
          className={cn(
            "rounded-full bg-maybe/15 px-2.5 py-1 text-[11px] font-semibold text-maybe transition-colors hover:bg-maybe/25 disabled:opacity-60",
          )}
        >
          Switch to maybe
        </button>
      ) : null}
      {side.myVote !== "out" ? (
        <button
          type="button"
          disabled={isPending}
          onClick={() => setVote("out")}
          className={cn(
            "rounded-full bg-out/15 px-2.5 py-1 text-[11px] font-semibold text-out transition-colors hover:bg-out/25 disabled:opacity-60",
          )}
        >
          Decline
        </button>
      ) : null}
      <Link
        href={`/c/${side.circleSlug}/p/${side.planId}`}
        className="ml-auto inline-flex items-center gap-1 rounded-full border border-ink/10 px-2.5 py-1 text-[11px] font-semibold text-ink-muted transition-colors hover:text-ink"
      >
        Open
        <ExternalLink className="size-3" aria-hidden />
      </Link>
      {err ? (
        <p className="basis-full text-[10px] text-out">{err}</p>
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
