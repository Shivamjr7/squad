"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  MoreHorizontal,
  RotateCcw,
  Sparkles,
  Undo2,
  XCircle,
} from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  cancelPlan,
  confirmPlan,
  markPlanDone,
  unconfirmPlan,
  uncancelPlan,
} from "@/lib/actions/plans";

type Status = "active" | "confirmed" | "done" | "cancelled";
type DialogKind = "confirm" | "unconfirm" | "done" | "cancel" | "uncancel";

type Props = {
  planId: string;
  status: Status;
  circleSlug: string;
  planTitle: string;
  planTimeLabel: string;
};

export function PlanOverflowMenu({
  planId,
  status,
  circleSlug,
  planTitle,
  planTimeLabel,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openDialog, setOpenDialog] = useState<DialogKind | null>(null);

  const close = () => setOpenDialog(null);

  const run = (
    fn: () => Promise<void>,
    {
      redirectHome = false,
      fallbackError = "Couldn't update plan.",
    }: { redirectHome?: boolean; fallbackError?: string } = {},
  ) => {
    startTransition(async () => {
      try {
        await fn();
        close();
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

  // Menu disappears entirely once the plan is `done`.
  if (status === "done") return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Plan options"
            className="size-9 rounded-full"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {status === "active" ? (
            <DropdownMenuItem onSelect={() => setOpenDialog("confirm")}>
              <Sparkles /> Confirm plan
            </DropdownMenuItem>
          ) : null}
          {status === "confirmed" ? (
            <DropdownMenuItem onSelect={() => setOpenDialog("unconfirm")}>
              <Undo2 /> Unconfirm
            </DropdownMenuItem>
          ) : null}
          {status === "active" || status === "confirmed" ? (
            <>
              <DropdownMenuItem onSelect={() => setOpenDialog("done")}>
                <CheckCircle2 /> Mark done
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setOpenDialog("cancel")}
              >
                <XCircle /> Cancel plan
              </DropdownMenuItem>
            </>
          ) : null}
          {status === "cancelled" ? (
            <DropdownMenuItem onSelect={() => setOpenDialog("uncancel")}>
              <RotateCcw /> Uncancel plan
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={openDialog === "confirm"}
        onOpenChange={(o) => !o && close()}
      >
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
              onClick={() => run(() => confirmPlan({ planId }))}
            >
              {pending ? "Confirming…" : "Yes, lock it in"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openDialog === "unconfirm"}
        onOpenChange={(o) => !o && close()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unconfirm this plan?</DialogTitle>
            <DialogDescription>
              It moves back to deciding. Voters stay, the plan itself doesn&apos;t
              go anywhere.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={pending}>
                Keep confirmed
              </Button>
            </DialogClose>
            <Button
              disabled={pending}
              onClick={() =>
                run(() => unconfirmPlan({ planId }), {
                  fallbackError: "Couldn't unconfirm plan.",
                })
              }
            >
              {pending ? "Unconfirming…" : "Yes, unconfirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openDialog === "done"}
        onOpenChange={(o) => !o && close()}
      >
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
                run(() => markPlanDone({ planId }), { redirectHome: true })
              }
            >
              {pending ? "Marking…" : "Mark done"}
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

      <Dialog
        open={openDialog === "uncancel"}
        onOpenChange={(o) => !o && close()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uncancel this plan?</DialogTitle>
            <DialogDescription>
              It moves back to deciding. Friends will see it under Upcoming
              again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={pending}>
                Keep cancelled
              </Button>
            </DialogClose>
            <Button
              disabled={pending}
              onClick={() => run(() => uncancelPlan({ planId }))}
            >
              {pending ? "Uncancelling…" : "Yes, uncancel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
