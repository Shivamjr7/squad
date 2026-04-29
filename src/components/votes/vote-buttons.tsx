"use client";

import { cn } from "@/lib/utils";
import type { VoteStatus } from "@/lib/validation/vote";

type Props = {
  selected: VoteStatus | null;
  onChange: (status: VoteStatus | null) => void;
  disabled?: boolean;
};

const ORDER: VoteStatus[] = ["in", "maybe", "out"];

const STYLE: Record<
  VoteStatus,
  { label: string; selected: string; ring: string }
> = {
  in: {
    label: "🟢 In",
    selected: "border-green-600 bg-green-600 text-white hover:bg-green-700",
    ring: "focus-visible:ring-green-600",
  },
  maybe: {
    label: "🟡 Maybe",
    selected:
      "border-yellow-500 bg-yellow-500 text-black hover:bg-yellow-600",
    ring: "focus-visible:ring-yellow-500",
  },
  out: {
    label: "🔴 Out",
    selected: "border-red-600 bg-red-600 text-white hover:bg-red-700",
    ring: "focus-visible:ring-red-600",
  },
};

export function VoteButtons({ selected, onChange, disabled }: Props) {
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
              // PlanCard wraps the upper card area in a <Link>; vote buttons
              // live outside that Link, but stop propagation defensively in
              // case future layouts nest them.
              e.stopPropagation();
              onChange(isSelected ? null : status);
            }}
            className={cn(
              "flex-1 touch-manipulation rounded-md border px-3 py-2 text-sm font-medium transition-all duration-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2",
              isSelected
                ? STYLE[status].selected
                : "border-input bg-background text-foreground hover:bg-accent active:bg-accent/80",
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
