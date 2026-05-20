"use client";

import Link from "next/link";
import { Plus, PlusCircle, Ticket } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Cross-circle home (`/`) chrome action: opens a small menu offering
// both create-circle and join-by-invite entry points. Replaces the
// older single-purpose "+ New" chip — previously the only way into
// /onboarding?mode=join was the empty-state on /onboarding itself,
// which signed-in users with one circle never reached.
export function AddCircleMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-9 items-center gap-1 rounded-full bg-ink/[0.06] px-3 text-[12.5px] font-semibold text-ink transition-colors hover:bg-ink/[0.10] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        aria-label="Add a circle"
      >
        <Plus className="size-3.5" strokeWidth={2.4} aria-hidden />
        Add
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-56">
        <DropdownMenuItem asChild>
          <Link href="/onboarding?mode=create" className="cursor-pointer">
            <PlusCircle aria-hidden />
            <div className="flex flex-col">
              <span className="font-medium">Create a circle</span>
              <span className="text-xs text-ink-muted">
                Start a new squad
              </span>
            </div>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/onboarding?mode=join" className="cursor-pointer">
            <Ticket aria-hidden />
            <div className="flex flex-col">
              <span className="font-medium">Have an invite link?</span>
              <span className="text-xs text-ink-muted">
                Join an existing one
              </span>
            </div>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
