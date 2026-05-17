"use client";

import { CalendarClock, MapPin } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatPlanTime } from "@/lib/format-plan-time";
import { cn } from "@/lib/utils";
import type { VoteConflict } from "@/lib/actions/conflicts";

// M32.3 — Scenarios 2 + 5 (CONVERGENCE_PLAN.md §4.1). Surfaces a pre-vote
// double-booking warning. Soft conflicts (MAYBE-side or approximate-side)
// never reach this component; callers gate on `getConflictForVote`'s
// null/non-null return, so when this mounts the conflict is always hard.
// Two actions: proceed (caller commits the vote) or cancel (caller discards
// the tap). The choice is per-tap by design — never remembered.

type Props = {
  open: boolean;
  conflict: VoteConflict | null;
  onConfirm: () => void;
  onCancel: () => void;
  // Optional verbs so the same sheet covers both the IN-vote tap and the
  // counter-proposal tap. Defaults match scenario 2.
  confirmLabel?: string;
  headline?: string;
};

export function ConflictWarningSheet({
  open,
  conflict,
  onConfirm,
  onCancel,
  confirmLabel = "Vote in anyway",
  headline,
}: Props) {
  // Lazy: when there's no conflict object yet we render the dialog closed so
  // the parent doesn't need to juggle two state values.
  const isOpen = open && conflict !== null;
  return (
    <Dialog open={isOpen} onOpenChange={(o) => (o ? null : onCancel())}>
      <DialogContent showCloseButton={false} className="gap-3">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            {headline ?? "Heads up — you're double-booking."}
          </DialogTitle>
          <DialogDescription>
            You&apos;re already in for this plan at the same time. Want to keep
            both?
          </DialogDescription>
        </DialogHeader>

        {conflict ? <ConflictCard conflict={conflict} /> : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            className="sm:order-1"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            className="sm:order-2 bg-coral text-white hover:bg-coral/90"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConflictCard({ conflict }: { conflict: VoteConflict }) {
  // Render in the plan's own zone (conflict.timeZone) so the hour matches
  // what the creator picked and what the rest of the app shows. Privacy
  // gate per §5 is enforced by getConflictForVote's memberships join — by
  // the time we get here, the viewer is allowed to see this plan.
  const timeLabel = formatPlanTime(
    new Date(conflict.start),
    false,
    new Date(),
    conflict.timeZone,
  );
  return (
    <div className="flex gap-3 rounded-xl border border-coral/30 bg-coral-soft/40 p-3">
      <span
        aria-hidden
        className={cn(
          "mt-1 size-2.5 shrink-0 rounded-full",
          conflict.circleColor,
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold text-ink">
            {conflict.planTitle}
          </span>
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-ink-muted">
            {conflict.circleName}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-muted">
          <CalendarClock className="size-3.5" aria-hidden />
          <span>{timeLabel}</span>
        </div>
        {conflict.venue ? (
          <div className="flex items-center gap-1.5 text-xs text-ink-muted">
            <MapPin className="size-3.5" aria-hidden />
            <span className="truncate">{conflict.venue}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
