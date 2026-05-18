"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, MoreVertical, UserMinus } from "lucide-react";
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
import { GradientAvatar } from "@/components/ui/gradient-avatar";
import { Pill } from "@/components/ui/pill";
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

// Relative join times for the first month, absolute date thereafter — the
// "joined 3 days ago" framing reads warmer for fresh members, while older
// dates carry better meaning as a fixed timestamp.
function formatJoined(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const DAY = 86_400_000;
  if (diffMs < 0) return JOINED_FMT.format(d);
  if (diffMs < DAY) return "today";
  if (diffMs < 2 * DAY) return "yesterday";
  const days = Math.floor(diffMs / DAY);
  if (days < 30) return `${days} days ago`;
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
      {/* Two-column grid on ≥md, single column on mobile. The card surface
          gives each member a stronger sense of presence on desktop where
          a flat list would be a lot of vertical scrolling. */}
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {members.map((m) => {
          const isMe = m.userId === currentUserId;
          const canRemove = isAdmin && !isMe;
          return (
            <li
              key={m.userId}
              className="flex items-center gap-3 rounded-xl border border-ink/10 bg-paper-card/40 px-3 py-3 transition-colors hover:bg-paper-card"
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
                    <Pill
                      tone="coral"
                      size="sm"
                      leading={<Lock className="size-2.5" aria-hidden />}
                    >
                      Admin
                    </Pill>
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
  return (
    <GradientAvatar
      seed={member.userId}
      name={member.displayName}
      src={member.avatarUrl}
      size="lg"
    />
  );
}
