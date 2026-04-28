"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";
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
  markPlanDone,
  uncancelPlan,
} from "@/lib/actions/plans";

type Status = "active" | "done" | "cancelled";

type Props = {
  planId: string;
  status: Status;
};

export function PlanStatusActions({ planId, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [doneOpen, setDoneOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const run = (
    fn: () => Promise<void>,
    onDone?: () => void,
    fallbackError = "Couldn't update plan.",
  ) => {
    startTransition(async () => {
      try {
        await fn();
        onDone?.();
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
        <RotateCcw /> Uncancel plan
      </Button>
    );
  }

  return (
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
                run(() => markPlanDone({ planId }), () => setDoneOpen(false))
              }
            >
              Mark done
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
                run(() => cancelPlan({ planId }), () => setCancelOpen(false))
              }
            >
              Cancel plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
