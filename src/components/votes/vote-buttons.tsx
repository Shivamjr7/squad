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

// Equal-weight palette: same height, same pill radius across all three. None
// of the three should dominate when nothing is selected. When a vote is cast,
// that button shifts to the solid variant; the other two stay in their soft
// variants. Selection is reinforced with a focus ring on the picked option.
const STYLE: Record<
  VoteStatus,
  { label: string; selected: string; unselected: string; ring: string }
> = {
  in: {
    label: "In",
    selected: "bg-green-500 text-white border border-green-500",
    unselected: "bg-green-50 text-green-700 border border-green-200",
    ring: "focus-visible:ring-green-500",
  },
  maybe: {
    label: "Maybe",
    selected: "bg-amber-400 text-amber-950 border border-amber-400",
    unselected: "bg-amber-50 text-amber-600 border border-amber-200",
    ring: "focus-visible:ring-amber-400",
  },
  out: {
    label: "Out",
    selected: "bg-red-500 text-white border border-red-500",
    unselected: "bg-red-50 text-red-500 border border-red-200",
    ring: "focus-visible:ring-red-500",
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
