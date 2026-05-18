import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Single source of truth for the small uppercase status/filter chips that
// were previously hand-rolled across ~20 callers (status-pill, status-
// countdown-pill, featured/feed plan cards, conflict sheets, etc.). Tone
// maps to the semantic color tokens defined in globals.css; size + variant
// keep the visual rhythm consistent without each caller re-deriving padding.

export type PillTone =
  | "coral"
  | "in"
  | "maybe"
  | "out"
  | "voting"
  | "muted"
  | "ink";

export type PillSize = "sm" | "md";

export type PillVariant = "soft" | "outline" | "solid";

type Props = {
  tone?: PillTone;
  size?: PillSize;
  variant?: PillVariant;
  /** Optional leading visual (icon, dot, etc.). Already gap-aligned. */
  leading?: ReactNode;
  className?: string;
  children: ReactNode;
};

const SIZE: Record<PillSize, string> = {
  sm: "px-2 py-0.5 text-[10px] tracking-[0.14em] gap-1",
  md: "px-2.5 py-1 text-[11px] tracking-[0.12em] gap-1.5",
};

// soft = filled tinted bg + strong text (default scannable chip)
// outline = transparent bg + ring + strong text (quieter, secondary)
// solid = filled color + paper text (rare; loud calls-to-attention)
const TONE: Record<PillTone, Record<PillVariant, string>> = {
  coral: {
    soft: "bg-coral-soft text-coral-strong",
    outline: "text-coral-strong ring-1 ring-coral-soft",
    solid: "bg-coral text-paper",
  },
  in: {
    soft: "bg-in-soft text-in-strong",
    outline: "text-in-strong ring-1 ring-in-soft",
    solid: "bg-in text-paper",
  },
  maybe: {
    soft: "bg-maybe-soft text-maybe-strong",
    outline: "text-maybe-strong ring-1 ring-maybe-soft",
    solid: "bg-maybe text-ink",
  },
  out: {
    soft: "bg-out-soft text-out-strong",
    outline: "text-out-strong ring-1 ring-out-soft",
    solid: "bg-out text-paper",
  },
  voting: {
    soft: "bg-voting-soft text-voting-strong",
    outline: "text-voting-strong ring-1 ring-voting-soft",
    solid: "bg-voting text-paper",
  },
  muted: {
    soft: "bg-paper-card text-ink-muted ring-1 ring-ink-subtle",
    outline: "text-ink-muted ring-1 ring-ink-subtle",
    solid: "bg-ink-subtle text-ink",
  },
  ink: {
    soft: "bg-ink/10 text-ink",
    outline: "text-ink ring-1 ring-ink/15",
    solid: "bg-ink text-paper",
  },
};

export const Pill = forwardRef<HTMLSpanElement, Props>(function Pill(
  {
    tone = "muted",
    size = "md",
    variant = "soft",
    leading,
    className,
    children,
  },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex w-fit items-center rounded-full font-semibold uppercase",
        SIZE[size],
        TONE[tone][variant],
        className,
      )}
    >
      {leading}
      <span className="tabular-nums">{children}</span>
    </span>
  );
});
