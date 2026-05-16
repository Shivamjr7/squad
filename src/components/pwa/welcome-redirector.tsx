"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const WELCOME_SEEN_KEY = "squad_welcome_seen";
const REVAMP_SEEN_KEY = "squad_notifications_revamp_seen";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const navStandalone = (
    window.navigator as Navigator & { standalone?: boolean }
  ).standalone;
  return (
    navStandalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

// One-time client-side redirect to /welcome (M31.7). Fires for two distinct
// audiences:
//   1. iOS Safari first-launch in standalone mode — we can't intercept the
//      share-sheet install, so we catch them the next time they open the PWA
//      from the home screen icon.
//   2. Legacy users (subscribed via M30 then upgraded to M31) on their first
//      authed page-load post-deploy, so they can re-opt-in to the new push
//      design.
// Both branches are gated by a localStorage flag + the user not yet having a
// push_subscriptions row (passed in as `hasAnyPushSubscription`). Once the
// user lands on /welcome the CTA flips both flags so we never redirect again.
export function WelcomeRedirector({
  hasAnyPushSubscription,
}: {
  hasAnyPushSubscription: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    if (hasAnyPushSubscription) return;

    let welcomeSeen: string | null = null;
    let revampSeen: string | null = null;
    try {
      welcomeSeen = localStorage.getItem(WELCOME_SEEN_KEY);
      revampSeen = localStorage.getItem(REVAMP_SEEN_KEY);
    } catch {
      // Private mode / storage blocked — bail rather than redirect-loop.
      return;
    }

    const standalonePath = isStandalone() && !welcomeSeen;
    const legacyPath = !revampSeen;
    if (!standalonePath && !legacyPath) return;

    // Mark the relevant flag right away so a race (e.g. user navigates back)
    // doesn't trigger a second redirect before /welcome's own mount sets it.
    try {
      if (standalonePath) localStorage.setItem(WELCOME_SEEN_KEY, "1");
      if (legacyPath) localStorage.setItem(REVAMP_SEEN_KEY, "1");
    } catch {
      // Best-effort.
    }
    router.replace("/welcome");
  }, [hasAnyPushSubscription, router]);

  return null;
}
