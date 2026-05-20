"use client";

import { Search } from "lucide-react";

// Opens the globally-mounted CommandPalette via a custom window event.
// The palette owns its own state; this button is purely a trigger.

export function SearchButton() {
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(new Event("squad:open-command-palette"));
      }}
      aria-label="Search"
      className="relative inline-flex size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-paper-card hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
    >
      <Search className="size-[18px]" strokeWidth={1.8} aria-hidden />
    </button>
  );
}
