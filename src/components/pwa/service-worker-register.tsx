"use client";

import { useEffect } from "react";

// Registers /sw.js once per page-load. The browser handles update cycling —
// re-registering the same script URL is a no-op when the bytes haven't
// changed. Skipped in dev to avoid the SW caching HMR responses.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failures are not user-actionable — swallow.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
