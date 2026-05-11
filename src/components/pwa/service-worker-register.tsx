"use client";

import { useEffect } from "react";

type DeferredPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __squadDeferredInstallPrompt?: DeferredPromptEvent | null;
  }
}

// Registers /sw.js once per page-load and stashes any beforeinstallprompt event
// the moment it fires. Chrome fires that event exactly once when the page first
// qualifies for install — usually on the landing route before the user
// navigates to /c/[slug] where InstallBanner mounts. Capturing it here (at the
// root layout) means the banner can read it on mount instead of missing it.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      window.__squadDeferredInstallPrompt = event as DeferredPromptEvent;
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    if (process.env.NODE_ENV !== "production") {
      return () => window.removeEventListener("beforeinstallprompt", onPrompt);
    }
    if (!("serviceWorker" in navigator)) {
      console.warn("[squad-sw] serviceWorker not supported by this browser");
      return () => window.removeEventListener("beforeinstallprompt", onPrompt);
    }

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          console.info("[squad-sw] registered, scope:", reg.scope);
        })
        .catch((err) => {
          console.error("[squad-sw] registration failed:", err);
        });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  return null;
}
