"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { VoteStatus } from "@/lib/validation/vote";

type Props = {
  selected: VoteStatus | null;
  onChange: (status: VoteStatus | null) => void;
  disabled?: boolean;
  size?: "default" | "lg";
};

const ORDER: VoteStatus[] = ["in", "maybe", "out"];

// Equal-weight palette built on the --in/--maybe/--out semantic tokens
// (globals.css). Selected = solid fill, unselected = soft tint with the
// -strong text variant for AA contrast on pale backgrounds. None dominates
// when nothing is picked; selection adds a tinted focus ring on press.
const STYLE: Record<
  VoteStatus,
  { label: string; selected: string; unselected: string; ring: string }
> = {
  in: {
    label: "In",
    selected: "bg-in text-white border border-in",
    unselected: "bg-in-soft text-in-strong border border-in-soft",
    ring: "focus-visible:ring-in",
  },
  maybe: {
    label: "Maybe",
    selected: "bg-maybe text-ink border border-maybe",
    unselected: "bg-maybe-soft text-maybe-strong border border-maybe-soft",
    ring: "focus-visible:ring-maybe",
  },
  out: {
    label: "Out",
    selected: "bg-out text-white border border-out",
    unselected: "bg-out-soft text-out-strong border border-out-soft",
    ring: "focus-visible:ring-out",
  },
};

export function VoteButtons({
  selected,
  onChange,
  disabled,
  size = "default",
}: Props) {
  const isLg = size === "lg";

  // Pop the pill that just *became* selected (not the one that was
  // already selected on first paint). Diff against a ref so the spring
  // only fires on the moment of commit. Cleared after the animation
  // window so re-renders don't loop it.
  const prevSelectedRef = useRef<VoteStatus | null>(selected);
  const [poppingStatus, setPoppingStatus] = useState<VoteStatus | null>(null);
  useEffect(() => {
    const prev = prevSelectedRef.current;
    prevSelectedRef.current = selected;
    if (selected === null || selected === prev) return;
    setPoppingStatus(selected);
    const t = setTimeout(() => setPoppingStatus(null), 260);
    return () => clearTimeout(t);
  }, [selected]);

  return (
    <div className="flex w-full gap-2">
      {ORDER.map((status) => {
        const isSelected = selected === status;
        const isPopping = poppingStatus === status;
        return (
          <button
            key={status}
            type="button"
            disabled={disabled}
            aria-pressed={isSelected}
            onClick={(e) => {
              e.stopPropagation();
              // Soft haptic on the commit. navigator.vibrate is no-op on
              // desktop and on iOS Safari (no Vibration API support);
              // wrapped in a feature check so we don't throw in SSR.
              if (
                typeof navigator !== "undefined" &&
                typeof navigator.vibrate === "function"
              ) {
                navigator.vibrate(10);
              }
              onChange(isSelected ? null : status);
            }}
            className={cn(
              "flex-1 touch-manipulation rounded-full font-semibold transition-all duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
              isLg ? "h-12 text-base" : "h-10 text-sm",
              isSelected ? STYLE[status].selected : STYLE[status].unselected,
              STYLE[status].ring,
              isPopping && "animate-vote-pop",
              disabled && "opacity-60",
            )}
          >
            {STYLE[status].label}
          </button>
        );
      })}
    </div>
  );
}
