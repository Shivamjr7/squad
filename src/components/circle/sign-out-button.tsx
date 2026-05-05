"use client";

import { SignOutButton } from "@clerk/nextjs";
import { LogOut } from "lucide-react";

export function YouSignOutButton() {
  return (
    <SignOutButton redirectUrl="/">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-ink/10 bg-paper-card/40 px-4 py-3 text-left text-sm font-medium text-ink transition-colors hover:bg-paper-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
      >
        <span className="flex items-center gap-2">
          <LogOut className="size-4" aria-hidden />
          Sign out
        </span>
      </button>
    </SignOutButton>
  );
}
