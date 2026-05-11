"use client";

import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";

const DISMISS_COOKIE = "squad_install_dismissed";
const DISMISS_DAYS = 30;

type Stage = "hidden" | "android" | "ios";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&")}=([^;]*)`),
  );
  return m ? decodeURIComponent(m[1]) : null;
}

function setDismissed() {
  const expires = new Date(Date.now() + DISMISS_DAYS * 86_400_000).toUTCString();
  document.cookie = `${DISMISS_COOKIE}=1; expires=${expires}; path=/; samesite=lax`;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari uses the legacy navigator.standalone; everyone else uses the
  // display-mode media query.
  const navStandalone = (
    window.navigator as Navigator & { standalone?: boolean }
  ).standalone;
  return (
    navStandalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS =
    /iPhone|iPad|iPod/.test(ua) ||
    // iPadOS 13+ identifies as Mac; the touch-points heuristic disambiguates.
    (ua.includes("Mac") && (navigator as Navigator).maxTouchPoints > 1);
  if (!iOS) return false;
  // Exclude in-app webviews that can't install (Chrome/Firefox/Edge on iOS).
  return !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function InstallBanner() {
  const [stage, setStage] = useState<Stage>("hidden");
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone()) return;
    if (readCookie(DISMISS_COOKIE)) return;

    // beforeinstallprompt fires exactly once, often on the public landing
    // before this component mounts. ServiceWorkerRegister captures it at the
    // root layout and stashes it on window — read that first.
    const stashed = window.__squadDeferredInstallPrompt;
    if (stashed) {
      setDeferredPrompt(stashed as BeforeInstallPromptEvent);
      setStage("android");
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setStage("android");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    if (isIosSafari() && !stashed) setStage("ios");

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (stage === "hidden") return null;

  const dismiss = () => {
    setDismissed();
    setStage("hidden");
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    window.__squadDeferredInstallPrompt = null;
    setStage("hidden");
    setDismissed();
  };

  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-ink/10 bg-paper-card px-3 py-2.5 shadow-sm sm:mx-6">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-medium text-ink">
          Install Squad
        </span>
        <span className="truncate text-xs text-ink-muted">
          {stage === "android" ? (
            "Add to your home screen for instant access."
          ) : (
            <>
              Tap{" "}
              <Share className="-mt-0.5 mx-0.5 inline-block h-3 w-3" />
              {" "}then &ldquo;Add to Home Screen&rdquo;.
            </>
          )}
        </span>
      </div>
      {stage === "android" ? (
        <button
          type="button"
          onClick={install}
          className="shrink-0 rounded-full bg-coral px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
        >
          Install
        </button>
      ) : null}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install prompt"
        className="shrink-0 rounded-full p-1 text-ink-muted hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
