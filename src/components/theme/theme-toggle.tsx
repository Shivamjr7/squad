"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

type Variant = "icon" | "row" | "segment";

type ThemeKey = "light" | "dark" | "system";

const SEGMENT_ORDER: ThemeKey[] = ["system", "light", "dark"];
const SEGMENT_LABEL: Record<ThemeKey, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

// Segment icons read literally: Sun for Light, Moon for Dark, Monitor
// for System. The ICONS map below uses cycle-shown semantics (the icon
// represents what's NEXT in the cycle), which doesn't apply to a
// segmented control where each pill states its own state.
const SEGMENT_ICONS: Record<ThemeKey, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

// Cycle order: light → dark → system → light. The icon shown represents
// what the user CURRENTLY has selected (moon for light, sun for dark,
// monitor for system) — matches the user's spec while remaining
// unambiguous: each icon is a clear visual cue for its own state.
const NEXT_THEME: Record<string, "light" | "dark" | "system"> = {
  light: "dark",
  dark: "system",
  system: "light",
};

const LABELS: Record<string, string> = {
  light: "Theme: light. Click to switch to dark.",
  dark: "Theme: dark. Click to switch to system.",
  system: "Theme: system. Click to switch to light.",
};

const ICONS = {
  light: Moon,
  dark: Sun,
  system: Monitor,
} as const;

export function ThemeToggle({
  variant = "icon",
  className,
}: {
  variant?: Variant;
  className?: string;
}) {
  const { theme, setTheme } = useTheme();
  // Avoid hydration mismatch — next-themes resolves on the client, so the
  // initial server render doesn't know the user's preference. We mount a
  // placeholder of identical size until the client takes over.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    if (variant === "row") {
      return (
        <div
          aria-hidden
          className={cn(
            "flex w-full items-center justify-between rounded-lg border border-ink-subtle bg-paper-card/40 px-4 py-3",
            className,
          )}
        >
          <span className="text-sm text-ink">Theme</span>
          <span className="size-5 opacity-0" />
        </div>
      );
    }
    if (variant === "segment") {
      return (
        <div
          aria-hidden
          className={cn(
            "inline-flex w-full items-center gap-1 rounded-full border border-ink-subtle bg-paper-card/40 p-1",
            className,
          )}
        >
          {SEGMENT_ORDER.map((k) => (
            <span
              key={k}
              className="flex flex-1 items-center justify-center px-3 py-1.5 text-xs text-ink-muted opacity-0"
            >
              {SEGMENT_LABEL[k]}
            </span>
          ))}
        </div>
      );
    }
    return (
      <span
        aria-hidden
        className={cn("inline-block size-9 shrink-0", className)}
      />
    );
  }

  const current = theme ?? "system";
  const Icon = ICONS[current as keyof typeof ICONS] ?? Monitor;
  const label = LABELS[current] ?? LABELS.system;
  const onClick = () => setTheme(NEXT_THEME[current] ?? "system");

  if (variant === "segment") {
    return (
      <div
        role="radiogroup"
        aria-label="Theme"
        className={cn(
          "inline-flex w-full items-center gap-1 rounded-full border border-ink-subtle bg-paper-card/40 p-1",
          className,
        )}
      >
        {SEGMENT_ORDER.map((k) => {
          const active = current === k;
          const IconK = SEGMENT_ICONS[k];
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(k)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral",
                active
                  ? "bg-coral text-paper shadow-sm"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              <IconK className="size-3.5" aria-hidden />
              {SEGMENT_LABEL[k]}
            </button>
          );
        })}
      </div>
    );
  }

  if (variant === "row") {
    const stateLabel =
      current === "system" ? "System" : current === "dark" ? "Dark" : "Light";
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          "flex w-full items-center justify-between rounded-lg border border-ink-subtle bg-paper-card/40 px-4 py-3 text-left transition-colors hover:bg-paper-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
          className,
        )}
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-sm text-ink">Theme</span>
          <span className="text-xs text-ink-muted">
            {stateLabel}
            {current === "system" ? " (follows your device)" : ""}
          </span>
        </span>
        <Icon className="size-5 text-ink-muted" aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-paper-card hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        className,
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
