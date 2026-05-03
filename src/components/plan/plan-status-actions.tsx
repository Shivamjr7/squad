"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCcw, Sparkles, Undo2, XCircle } from "lucide-react";
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
import {
  cancelPlan,
  confirmPlan,
  markPlanDone,
  unconfirmPlan,
  uncancelPlan,
} from "@/lib/actions/plans";

type Status = "active" | "confirmed" | "done" | "cancelled";

type Props = {
  planId: string;
  status: Status;
  circleSlug: string;
  planTitle: string;
  planTimeLabel: string;
};

export function PlanStatusActions({
  planId,
  status,
  circleSlug,
  planTitle,
  planTimeLabel,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const run = (
    fn: () => Promise<void>,
    {
      onDone,
      redirectHome = false,
      fallbackError = "Couldn't update plan.",
    }: {
      onDone?: () => void;
      redirectHome?: boolean;
      fallbackError?: string;
    } = {},
  ) => {
    startTransition(async () => {
      try {
        await fn();
        onDone?.();
        if (redirectHome) {
          router.push(`/c/${circleSlug}`);
        }
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : fallbackError;
        toast.error(message);
      }
    });
  };

  if (status === "done") return null;

  if (status === "cancelled") {
    return (
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => run(() => uncancelPlan({ planId }))}
        className="w-full sm:w-auto"
      >
        <RotateCcw /> {pending ? "Uncancelling…" : "Uncancel plan"}
      </Button>
    );
  }

  // For both `active` and `confirmed` we render: lock-in / unlock action
  // plus Mark done + Cancel. The lock-in slot swaps based on current state.
  return (
    <div className="flex flex-col gap-2">
      {status === "active" ? (
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <Button
            disabled={pending}
            onClick={() => setConfirmOpen(true)}
            className="w-full"
          >
            <Sparkles /> Confirm this plan
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Confirm {planTitle} for {planTimeLabel}?
              </DialogTitle>
              <DialogDescription>
                Friends will see it locked in. Voting stays open — anyone can
                still join after.
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
                onClick={() =>
                  run(() => confirmPlan({ planId }), {
                    onDone: () => setConfirmOpen(false),
                  })
                }
              >
                {pending ? "Confirming…" : "Yes, lock it in"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() =>
            run(() => unconfirmPlan({ planId }), {
              fallbackError: "Couldn't unconfirm plan.",
            })
          }
          className="w-full"
        >
          <Undo2 /> {pending ? "Unconfirming…" : "Unconfirm"}
        </Button>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Dialog open={doneOpen} onOpenChange={setDoneOpen}>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => setDoneOpen(true)}
            className="flex-1"
          >
            <CheckCircle2 /> Mark done
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Mark this plan done?</DialogTitle>
              <DialogDescription>
                Friends will see it move to Past. Voting and discussion stay
                visible.
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
                onClick={() =>
                  run(() => markPlanDone({ planId }), {
                    onDone: () => setDoneOpen(false),
                    redirectHome: true,
                  })
                }
              >
                {pending ? "Marking…" : "Mark done"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => setCancelOpen(true)}
            className="flex-1"
          >
            <XCircle /> Cancel plan
          </Button>
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
                  run(() => cancelPlan({ planId }), {
                    onDone: () => setCancelOpen(false),
                    redirectHome: true,
                  })
                }
              >
                {pending ? "Cancelling…" : "Yes, cancel plan"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
