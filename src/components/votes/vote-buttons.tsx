"use client";

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
  return (
    <div className="flex w-full gap-2">
      {ORDER.map((status) => {
        const isSelected = selected === status;
        return (
          <button
            key={status}
            type="button"
            disabled={disabled}
            aria-pressed={isSelected}
            onClick={(e) => {
              e.stopPropagation();
              onChange(isSelected ? null : status);
            }}
            className={cn(
              "flex-1 touch-manipulation rounded-full font-semibold transition-all duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
              isLg ? "h-12 text-base" : "h-10 text-sm",
              isSelected ? STYLE[status].selected : STYLE[status].unselected,
              STYLE[status].ring,
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
