"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

type Variant = "icon" | "row";

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
