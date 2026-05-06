"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { addPlanRecipients } from "@/lib/actions/plan-recipients";

export type RecipientCircleMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

type Props = {
  planId: string;
  // Full circle membership — used to compute "who could still be added".
  circleMembers: RecipientCircleMember[];
  // Currently invited user_ids. When the plan is implicit-full-circle, this
  // equals every member id; otherwise it's the explicit subset.
  recipientIds: string[];
  // Whether the plan recipients are implicit (no rows in plan_recipients,
  // back-compat path). Drives the "Everyone" badge.
  isAll: boolean;
  // Add button is only shown to plan creators / circle admins.
  canAdd: boolean;
  // When the plan is locked / cancelled / done, additions are noise.
  isPlanActive: boolean;
};

export function PlanRecipientsSection({
  planId,
  circleMembers,
  recipientIds,
  isAll,
  canAdd,
  isPlanActive,
}: Props) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [pending, startTransition] = useTransition();

  // Members already in the recipient set, in stable order.
  const inRecipients = useMemo(() => {
    const set = new Set(recipientIds);
    return circleMembers.filter((m) => set.has(m.userId));
  }, [circleMembers, recipientIds]);

  // Members who could still be added — anyone not already a recipient.
  const addable = useMemo(() => {
    const set = new Set(recipientIds);
    return circleMembers.filter((m) => !set.has(m.userId));
  }, [circleMembers, recipientIds]);

  const showAddButton = canAdd && isPlanActive && addable.length > 0;

  function togglePick(userId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function onSubmit() {
    if (picked.size === 0) return;
    const userIds = Array.from(picked);
    startTransition(async () => {
      try {
        await addPlanRecipients({ planId, userIds });
        toast.success(
          userIds.length === 1
            ? "Added 1 person"
            : `Added ${userIds.length} people`,
        );
        setPicked(new Set());
        setOpen(false);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Could not add recipients.";
        toast.error(msg);
      }
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
          Squad
        </span>
        <span className="text-xs text-ink-muted">
          {isAll
            ? `Everyone · ${inRecipients.length}`
            : `${inRecipients.length} invited`}
        </span>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {inRecipients.map((m) => (
          <li
            key={m.userId}
            className="flex items-center gap-1.5 rounded-full border border-ink/15 bg-paper-card/60 px-2 py-1 text-xs text-ink"
          >
            <Avatar member={m} />
            <span className="max-w-32 truncate">{m.displayName}</span>
          </li>
        ))}
        {showAddButton ? (
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex items-center gap-1 rounded-full border border-dashed border-ink/25 bg-transparent px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-ink/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
              aria-label="Add a member to this plan"
            >
              <Plus className="size-3.5" aria-hidden />
              Add
            </button>
          </li>
        ) : null}
      </ul>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[90dvh] gap-0 bg-paper p-0 sm:max-w-md"
        >
          <SheetHeader className="border-b border-ink/10 px-5 pt-5 pb-4">
            <SheetTitle className="font-serif text-xl font-semibold text-ink">
              Add to plan
            </SheetTitle>
          </SheetHeader>
          <div className="flex max-h-[60dvh] flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
            {addable.map((m) => {
              const isPicked = picked.has(m.userId);
              return (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() => togglePick(m.userId)}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                    isPicked
                      ? "bg-coral-soft"
                      : "hover:bg-paper-card/60",
                  )}
                  aria-pressed={isPicked}
                >
                  <Avatar member={m} size="lg" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {m.displayName}
                  </span>
                  {isPicked ? (
                    <span className="flex size-5 items-center justify-center rounded-full bg-coral text-paper-card">
                      <Plus className="size-3 rotate-45" aria-hidden />
                    </span>
                  ) : (
                    <Plus className="size-4 text-ink-muted" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-ink/10 bg-paper px-5 py-3">
            <button
              type="button"
              onClick={() => {
                setPicked(new Set());
                setOpen(false);
              }}
              className="text-sm text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
            >
              Cancel
            </button>
            <Button
              type="button"
              onClick={onSubmit}
              disabled={picked.size === 0 || pending}
              className="rounded-full"
            >
              {pending
                ? "Adding…"
                : picked.size === 0
                  ? "Pick someone"
                  : `Add ${picked.size}`}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}

function Avatar({
  member,
  size = "sm",
}: {
  member: RecipientCircleMember;
  size?: "sm" | "lg";
}) {
  const dim = size === "lg" ? "size-9" : "size-5";
  const text = size === "lg" ? "text-sm" : "text-[9px]";
  if (member.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.avatarUrl}
        alt=""
        className={`${dim} shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <span
      className={`${dim} shrink-0 flex items-center justify-center rounded-full bg-ink/10 ${text} font-semibold uppercase text-ink`}
    >
      {member.displayName.slice(0, 1)}
    </span>
  );
}

