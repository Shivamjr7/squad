"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { leaveCircle } from "@/lib/actions/circles";

type Props = {
  circleId: string;
  circleName: string;
  isLastAdmin: boolean;
};

export function LeaveCircleButton({ circleId, circleName, isLastAdmin }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onConfirm() {
    startTransition(async () => {
      try {
        await leaveCircle({ circleId });
        toast.success(`Left ${circleName}`);
        router.replace("/");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't leave.";
        toast.error(msg);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-ink/10 bg-paper-card/40 px-4 py-3 text-left text-sm font-medium text-destructive transition-colors hover:bg-paper-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
      >
        <span className="flex items-center gap-2">
          <LogOut className="size-4" aria-hidden />
          Leave circle
        </span>
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => !pending && setOpen(next)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave {circleName}?</DialogTitle>
            <DialogDescription>
              {isLastAdmin
                ? "You're the last admin. Promote someone else first, otherwise the circle has no admins."
                : "You'll lose access to this circle's plans, votes, and comments. You can rejoin if someone sends you a new invite."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={pending || isLastAdmin}
            >
              {pending ? "Leaving…" : "Leave"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
