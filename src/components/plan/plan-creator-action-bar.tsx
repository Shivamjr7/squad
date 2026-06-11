"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cancelPlan, confirmPlan } from "@/lib/actions/plans";

type Status = "active" | "confirmed" | "done" | "cancelled";
type DialogKind = "cancel" | "set" | null;

type Props = {
  planId: string;
  status: Status;
  circleSlug: string;
  planTitle: string;
  planTimeLabel: string;
};

// M31.4 — sticky bottom bar mirroring the reference mock's
// "Cancel | Mark as set" affordance for plan creators + admins. Hidden
// once the plan is confirmed / done / cancelled (those states have no
// "set it now" semantics). The PlanOverflowMenu still carries these
// actions for redundancy, including for past plans where the bar
// disappears.
//
// Positioning: full-width shelf anchored to the bottom (z-30 so the
// floating mobile tab pill at z-40 still wins for swipe-edge gestures).
// The shelf extends down to the viewport edge so page content doesn't
// peek through the gap behind the tab pill. On desktop (md+) the same
// shelf renders without a tab pill below — extra bottom padding becomes
// the iOS home-indicator safe-area only.
export function PlanCreatorActionBar({
  planId,
  status,
  circleSlug,
  planTitle,
  planTimeLabel,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openDialog, setOpenDialog] = useState<DialogKind>(null);

  if (status !== "active") return null;

  const close = () => setOpenDialog(null);

  const run = (
    fn: () => Promise<void>,
    { redirectHome = false }: { redirectHome?: boolean } = {},
  ) => {
    close();
    if (redirectHome) router.push(`/c/${circleSlug}`);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't update plan.",
        );
      }
    });
  };

  return (
    <>
      <div
        // Anchored bottom-0; the bottom padding pushes the buttons up to
        // sit just above the floating mobile tab pill (~62px tall + 8px
        // outer margin) plus the iOS home-indicator safe area. The shelf
        // background fills everything below the buttons so nothing
        // scrolls through the gap behind the tab pill. On md+ the tab
        // pill is hidden, so the bottom padding shrinks to the safe area.
        className="fixed inset-x-0 bottom-0 z-30 border-t border-ink/10 bg-paper px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+76px)] shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.12)] md:px-6 md:pb-[max(env(safe-area-inset-bottom,0px),0.75rem)]"
      >
        <div className="mx-auto grid w-full max-w-2xl grid-cols-2 items-stretch gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 w-full rounded-2xl border border-coral/30 bg-paper px-4 text-sm font-semibold text-coral-strong shadow-none hover:bg-coral-soft"
            disabled={pending}
            onClick={() => setOpenDialog("cancel")}
          >
            <X aria-hidden className="size-4" />
            <span className="leading-none">Cancel plan</span>
          </Button>
          <Button
            type="button"
            size="lg"
            className="h-11 w-full rounded-2xl border border-transparent bg-in px-4 text-sm font-semibold text-paper shadow-none hover:bg-in/90"
            disabled={pending}
            onClick={() => setOpenDialog("set")}
          >
            <Lock aria-hidden className="size-4" />
            <span className="leading-none">Lock in</span>
          </Button>
        </div>
      </div>

      <Dialog open={openDialog === "set"} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Lock {planTitle} in for {planTimeLabel}?
            </DialogTitle>
            <DialogDescription>
              Locks the plan in. After lock, people can only drop out.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={pending}>
                Not yet
              </Button>
            </DialogClose>
            <Button
              disabled={pending}
              onClick={() => run(() => confirmPlan({ planId }))}
            >
              {pending ? "Locking…" : "Yes, lock it in"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openDialog === "cancel"}
        onOpenChange={(o) => !o && close()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this plan?</DialogTitle>
            <DialogDescription>
              Friends who voted In or Maybe will be notified. You can uncancel
              within 24 hours.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={pending}>
                Keep plan
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                run(() => cancelPlan({ planId }), { redirectHome: true })
              }
            >
              {pending ? "Cancelling…" : "Yes, cancel plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
