"use client";

import { toast } from "sonner";

// Post-commit "I'm in" share affordance. Called after a successful vote
// to "in"; surfaces a toast with a Share action. Web Share API on
// platforms that support it (most mobile + recent desktop browsers),
// clipboard-copy fallback elsewhere. One-shot per (planId × tab session)
// so the user isn't nagged when re-voting or toggling.

const SESSION_PREFIX = "squad.share-im-in.";

type ShareSpec = {
  planId: string;
  title: string;
  startsAt: Date | string;
  circleSlug: string;
  timeZone?: string;
};

function fmtWhen(startsAt: Date, timeZone?: string): string {
  const now = new Date();
  const sameDay =
    startsAt.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = startsAt.toDateString() === tomorrow.toDateString();
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(startsAt);
  if (sameDay) return `tonight at ${time}`;
  if (isTomorrow) return `tomorrow at ${time}`;
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(startsAt);
  return `${day} at ${time}`;
}

function buildShareUrl(circleSlug: string, planId: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/c/${circleSlug}/p/${planId}`;
}

function alreadyOfferedThisSession(planId: string): boolean {
  if (typeof window === "undefined") return true;
  return Boolean(window.sessionStorage.getItem(SESSION_PREFIX + planId));
}

function markOfferedThisSession(planId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(SESSION_PREFIX + planId, "1");
}

export function offerShareImIn(spec: ShareSpec): void {
  if (alreadyOfferedThisSession(spec.planId)) return;
  markOfferedThisSession(spec.planId);

  const startsAt =
    spec.startsAt instanceof Date ? spec.startsAt : new Date(spec.startsAt);
  const whenLabel = fmtWhen(startsAt, spec.timeZone);
  const url = buildShareUrl(spec.circleSlug, spec.planId);
  const text = `I'm in for ${spec.title} ${whenLabel}.`;

  const canShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function";

  toast.success("You're in.", {
    description: "Want to ping the squad?",
    action: {
      label: canShare ? "Share" : "Copy link",
      onClick: () => {
        if (canShare) {
          // Errors swallowed — user might cancel the native sheet, which
          // throws AbortError. We don't want to noisy-toast that.
          void navigator
            .share({ title: spec.title, text, url })
            .catch(() => {});
          return;
        }
        // Clipboard fallback. If clipboard is also unavailable (rare —
        // mostly old/insecure contexts), drop to a simple toast.
        if (
          typeof navigator !== "undefined" &&
          typeof navigator.clipboard?.writeText === "function"
        ) {
          void navigator.clipboard
            .writeText(`${text} ${url}`)
            .then(() => toast.success("Link copied."))
            .catch(() => toast.error("Couldn't copy. Try again?"));
          return;
        }
        toast.message(`${text} ${url}`);
      },
    },
    duration: 4500,
  });
}
