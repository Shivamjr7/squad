"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

// Placeholder for M7 / future AI-suggestion work. Hardcodes a sample
// suggestion until pattern detection lands.
export function QuickNudge() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <section
      aria-labelledby="quick-nudge-heading"
      className="rounded-3xl border border-coral/20 bg-coral-soft/40 p-4 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-coral/20 text-coral">
          <Sparkles className="size-3.5" aria-hidden />
        </span>
        <h2
          id="quick-nudge-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.18em] text-coral"
        >
          Quick nudge
        </h2>
      </div>
      <p className="mt-3 font-serif text-lg leading-tight text-ink">
        Brunch Sunday?
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        You usually meet on Sundays around 11am.
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => toast.info("Polls land in a future milestone.")}
          className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-paper-card transition hover:bg-ink/90"
        >
          Send poll
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-full border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink-muted transition hover:bg-paper"
        >
          Skip
        </button>
      </div>
    </section>
  );
}
