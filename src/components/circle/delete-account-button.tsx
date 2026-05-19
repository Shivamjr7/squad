"use client";

import { useState, useTransition } from "react";
import { useClerk } from "@clerk/nextjs";
import { Trash2 } from "lucide-react";
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
import { deleteAccount } from "@/lib/actions/users";

export function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();
  const { signOut } = useClerk();

  function onConfirm() {
    startTransition(async () => {
      try {
        await deleteAccount();
        // Server already deleted the Clerk user. Calling signOut() clears
        // the local session token and routes to "/".
        await signOut({ redirectUrl: "/" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't delete.";
        toast.error(msg);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-paper-card/40 px-4 py-3 text-left text-sm font-medium text-destructive transition-colors hover:bg-paper-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
      >
        <span className="flex items-center gap-2">
          <Trash2 className="size-4" aria-hidden />
          Delete account
        </span>
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return;
          setOpen(next);
          if (!next) setConfirm("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your Squad account?</DialogTitle>
            <DialogDescription>
              Your votes, comments, memberships, and notification settings will
              be deleted immediately. Plans you created stay live with your
              name removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <label htmlFor="confirm-delete" className="text-sm text-ink">
              Type{" "}
              <span className="font-mono text-destructive">DELETE</span> to
              confirm:
            </label>
            <input
              id="confirm-delete"
              type="text"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={pending}
              className="rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-destructive/40"
            />
          </div>
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
              disabled={pending || confirm !== "DELETE"}
            >
              {pending ? "Deleting…" : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
