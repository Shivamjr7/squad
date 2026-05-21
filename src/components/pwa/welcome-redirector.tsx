"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const WELCOME_SEEN_KEY = "squad_welcome_seen";

// M31.7 — one-time client-side redirect to /welcome on the first authed
// page load. Permission is asked when the user *uses* the app, not at install
// time (NOTIFICATIONS_PLAN.md §4). No UA sniff, no display-mode gating: a
// browser-tab user and a standalone-PWA user hit the same path.
//
// Fires when both:
//   1. The user has no push_subscriptions row on any device.
//   2. localStorage `squad_welcome_seen` is absent — set by either the
//      WelcomeCta on mount or this redirector before navigating, so we never
//      send the same user to /welcome twice.
export function WelcomeRedirector({
  hasAnyPushSubscription,
}: {
  hasAnyPushSubscription: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    if (hasAnyPushSubscription) return;

    let welcomeSeen: string | null = null;
    try {
      welcomeSeen = localStorage.getItem(WELCOME_SEEN_KEY);
    } catch {
      // Private mode / storage blocked — bail rather than redirect-loop.
      return;
    }
    if (welcomeSeen) return;

    // Mark the flag right away so a race (e.g. user navigates back) doesn't
    // trigger a second redirect before /welcome's own mount sets it.
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, "1");
    } catch {
      // Best-effort.
    }
    router.replace("/welcome");
  }, [hasAnyPushSubscription, router]);

  return null;
}
