"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, UserMinus } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { removeMember } from "@/lib/actions/circles";

export type ListMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: "admin" | "member";
  joinedAt: string; // ISO
};

type Props = {
  circleId: string;
  members: ListMember[];
  currentUserId: string;
  isAdmin: boolean;
};

const JOINED_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatJoined(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return JOINED_FMT.format(d);
}

export function MembersList({
  circleId,
  members,
  currentUserId,
  isAdmin,
}: Props) {
  const [target, setTarget] = useState<ListMember | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onConfirmRemove() {
    if (!target) return;
    const name = target.displayName;
    startTransition(async () => {
      try {
        await removeMember({ circleId, userId: target.userId });
        toast.success(`Removed ${name}`);
        setTarget(null);
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't remove.";
        toast.error(msg);
      }
    });
  }

  return (
    <>
      <ul className="flex flex-col">
        {members.map((m) => {
          const isMe = m.userId === currentUserId;
          const canRemove = isAdmin && !isMe;
          return (
            <li
              key={m.userId}
              className="flex items-center gap-3 rounded-md px-2 py-3"
            >
              <Avatar member={m} />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {m.displayName}
                    {isMe ? (
                      <span className="ml-1 text-ink-muted">(you)</span>
                    ) : null}
                  </span>
                  {m.role === "admin" ? (
                    <span className="shrink-0 rounded-full bg-paper-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                      Admin
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-ink-muted">
                  Joined {formatJoined(m.joinedAt)}
                </span>
              </div>
              {canRemove ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-ink-muted"
                      aria-label={`Manage ${m.displayName}`}
                    >
                      <MoreVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={(e) => {
                        e.preventDefault();
                        setTarget(m);
                      }}
                    >
                      <UserMinus className="size-4" />
                      Remove from circle
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={target !== null}
        onOpenChange={(next) => !next && !pending && setTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {target?.displayName}?</DialogTitle>
            <DialogDescription>
              They&apos;ll lose access to plans, votes, and comments in this
              circle. They can be re-invited later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setTarget(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirmRemove}
              disabled={pending}
            >
              {pending ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Avatar({ member }: { member: ListMember }) {
  if (member.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.avatarUrl}
        alt=""
        className="size-10 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink/10 text-sm font-medium uppercase text-ink">
      {member.displayName.slice(0, 1)}
    </span>
  );
}
