"use client";

import { useEffect, useState } from "react";
import { Pill, type PillTone } from "@/components/ui/pill";

type Status = "active" | "confirmed" | "done" | "cancelled";

type Props = {
  status: Status;
  startsAt: string; // ISO — serializable across the server boundary
  decideBy: string | null;
  timeZone?: string;
};

// Active plans within the last hour before decideBy show a ticking m:ss
// countdown ("DECIDING · 1:08"). Outside that window, falls back to the
// same static labels the page used pre-M31.
//
// Render parity with the server-rendered initial pill: we seed the same
// strings the server would produce, then upgrade on mount once the
// useEffect installs the tick. No hydration mismatch because the first
// render uses `decideBy - serverNow` math equivalent to the server's.
export function StatusCountdownPill({
  status,
  startsAt,
  decideBy,
  timeZone,
}: Props) {
  const decideAt = decideBy ? new Date(decideBy) : null;

  // Tick once per second only when we're inside the countdown window.
  // We re-evaluate on each render whether that's still true so the timer
  // shuts itself off at zero.
  const [now, setNow] = useState<Date>(() => new Date());
  const remainingMs = decideAt ? decideAt.getTime() - now.getTime() : null;
  const inCountdownWindow =
    status === "active" &&
    remainingMs !== null &&
    remainingMs > 0 &&
    remainingMs <= 60 * 60 * 1000;

  useEffect(() => {
    if (!inCountdownWindow) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [inCountdownWindow]);

  let label: string;
  let tone: "deciding" | "confirmed" | "muted";
  let prefix: "dot" | "check" | null = null;

  if (status === "cancelled") {
    label = "Cancelled";
    tone = "muted";
  } else if (status === "done") {
    label = "Done";
    tone = "muted";
  } else if (status === "confirmed") {
    label = `Confirmed · ${shortDay(new Date(startsAt), timeZone).toUpperCase()} ${shortTime(new Date(startsAt), timeZone)}`;
    tone = "confirmed";
    prefix = "check";
  } else if (inCountdownWindow && remainingMs !== null) {
    label = `Deciding · ${formatCountdown(remainingMs)}`;
    tone = "deciding";
    prefix = "dot";
  } else if (remainingMs !== null && remainingMs <= 0) {
    label = "Locking now";
    tone = "deciding";
    prefix = "dot";
  } else if (decideAt) {
    label = `Deciding now · Ends ${shortTime(decideAt, timeZone)}`;
    tone = "deciding";
    prefix = "dot";
  } else {
    label = "Deciding now";
    tone = "deciding";
    prefix = "dot";
  }

  const pillTone: PillTone =
    tone === "confirmed" ? "in" : tone === "deciding" ? "coral" : "muted";

  // Imminent state — < 5 min remaining and still deciding. Replaces the
  // calm pulse-soft dot with a faster, deeper pulse-urgent and adds a
  // 1px sine wobble on the label so the pill reads "this is happening".
  // prefers-reduced-motion zeros both animations (see globals.css).
  const isImminent =
    inCountdownWindow &&
    remainingMs !== null &&
    remainingMs > 0 &&
    remainingMs <= 5 * 60 * 1000;

  return (
    <Pill
      tone={pillTone}
      size="md"
      leading={
        prefix === "dot" ? (
          <span
            aria-hidden
            className={
              "size-1.5 rounded-full " +
              (isImminent
                ? "bg-coral-strong animate-pulse-urgent"
                : "bg-coral animate-pulse-soft")
            }
          />
        ) : prefix === "check" ? (
          <span aria-hidden>✓</span>
        ) : null
      }
      className={isImminent ? "animate-wobble-imminent" : undefined}
    >
      {label}
    </Pill>
  );
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 10) {
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function shortTime(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

function shortDay(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    timeZone,
  }).format(date);
}
