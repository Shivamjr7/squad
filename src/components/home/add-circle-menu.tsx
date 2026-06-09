"use client";

import { useState } from "react";
import { Plus, PlusCircle, Ticket } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateCircleForm } from "@/components/onboarding/create-circle-form";
import { JoinViaCodeForm } from "@/components/onboarding/join-via-code-form";
import { cn } from "@/lib/utils";

type Mode = "create" | "join";
type AddCircleMenuVariant = "header" | "empty";

// Cross-circle home (`/`) chrome action: opens a small menu offering
// both create-circle and join-by-invite entry points. Replaces the
// older single-purpose "+ New" chip — previously the only way into
// /onboarding?mode=join was the empty-state on /onboarding itself,
// which signed-in users with one circle never reached.
export function AddCircleMenu({
  variant = "header",
}: {
  variant?: AddCircleMenuVariant;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const title = mode === "join" ? "Join a circle" : "Create a circle";
  const isEmpty = variant === "empty";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
              isEmpty
                ? "group flex min-h-[280px] w-full flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-ink/12 bg-paper-card/55 px-6 py-12 text-center transition-colors hover:border-coral/35 hover:bg-paper-card/80"
                : "inline-flex h-9 items-center gap-1 rounded-full bg-ink/[0.06] px-3 text-[12.5px] font-semibold text-ink transition-colors hover:bg-ink/[0.10]",
            )}
            aria-label={isEmpty ? "Start with a circle" : "Add a circle"}
            data-tour={isEmpty ? undefined : "home-add-circle"}
          >
            {isEmpty ? (
              <>
                <span
                  aria-hidden
                  className="flex size-12 items-center justify-center rounded-full bg-coral/10 text-coral transition-colors group-hover:bg-coral/15"
                >
                  <Plus className="size-5" />
                </span>
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-semibold text-ink">
                    Start with a circle
                  </span>
                  <span className="max-w-xs text-sm leading-relaxed text-ink-muted">
                    Create one for your squad, or join with an invite link from
                    a friend.
                  </span>
                </span>
              </>
            ) : (
              <>
                <Plus className="size-3.5" strokeWidth={2.4} aria-hidden />
                Add circle
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="min-w-56">
          <DropdownMenuItem
            onSelect={() => setMode("create")}
            className="cursor-pointer"
          >
            <PlusCircle aria-hidden />
            <div className="flex flex-col">
              <span className="font-medium">Create a circle</span>
              <span className="text-xs text-ink-muted">
                Start a new squad
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setMode("join")}
            className="cursor-pointer"
          >
            <Ticket aria-hidden />
            <div className="flex flex-col">
              <span className="font-medium">Have an invite link?</span>
              <span className="text-xs text-ink-muted">
                Join an existing one
              </span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={mode !== null} onOpenChange={(open) => !open && setMode(null)}>
        <DialogContent className="max-w-md rounded-2xl p-0">
          <div className="flex flex-col gap-5 p-5 sm:p-6">
            <div className="flex flex-col gap-1">
              <DialogTitle className="font-serif text-2xl font-semibold text-ink">
                {title}
              </DialogTitle>
              <p className="text-sm leading-relaxed text-ink-muted">
                {mode === "join"
                  ? "Paste the invite your friend sent you."
                  : "Name the squad you plan with most."}
              </p>
            </div>
            {mode === "join" ? <JoinViaCodeForm /> : <CreateCircleForm />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
