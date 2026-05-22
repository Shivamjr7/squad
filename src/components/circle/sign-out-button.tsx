"use client";

import { SignOutButton } from "@clerk/nextjs";
import { LogOut } from "lucide-react";

// Tell the service worker to drop cached HTML pages right before Clerk
// kicks off the sign-out redirect. Without this, on a shared device the
// next user's "offline reload" can serve the previous user's /c/<slug>
// shell out of CACHE_VERSION (RSC payloads include user-specific state).
// The SW listens for the "squad:purge-auth-cache" message and clears
// every entry that isn't in PRECACHE / SOFT_PRECACHE.
function purgeAuthCache() {
  if (typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => {
      reg.active?.postMessage({ type: "squad:purge-auth-cache" });
    })
    .catch(() => {});
}

export function YouSignOutButton() {
  return (
    <SignOutButton redirectUrl="/">
      <button
        type="button"
        onClick={purgeAuthCache}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-ink/10 bg-paper-card/40 px-4 py-3 text-left text-sm font-medium text-ink transition-colors hover:bg-paper-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
      >
        <span className="flex items-center gap-2">
          <LogOut className="size-4" aria-hidden />
          Sign out
        </span>
      </button>
    </SignOutButton>
  );
}
