"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, Share, X } from "lucide-react";
import { toast } from "sonner";
import { setPushSubscription } from "@/lib/actions/push-subscriptions";
import type {
  PushSubscriptionInput,
  SubscribePushInput,
} from "@/lib/validation/push-subscription";

const DISMISS_COOKIE = "squad_install_dismissed";
const DISMISS_DAYS = 30;

// Stages encode the install-moment chain:
//   android  — Chrome / desktop with a stashed beforeinstallprompt
//   ios      — iOS Safari, manual share-sheet install (no JS prompt)
//   notify   — after Android install accepted, ask for notification permission
//              inside the same user-gesture chain
//   hidden   — banner is gone (either install + opt-in done, or dismissed)
type Stage = "hidden" | "android" | "ios" | "notify";

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
    (ua.includes("Mac") && (navigator as Navigator).maxTouchPoints > 1);
  if (!iOS) return false;
  return !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function detectDeviceHint(): "mobile" | "desktop" {
  return /Mobi|Android/i.test(navigator.userAgent) ? "mobile" : "desktop";
}

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return view;
}

async function subscribeAndPersist(vapidKey: string): Promise<void> {
  const reg =
    (await navigator.serviceWorker.getRegistration()) ??
    (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
  }
  const json = sub.toJSON() as PushSubscriptionInput;
  const payload: SubscribePushInput = {
    subscription: json,
    deviceHint: detectDeviceHint(),
  };
  await setPushSubscription(payload);
}

// Install-moment surface. The install gesture is the only natural place to
// ask for notification permission — we never ask on the home feed (M31.7).
// On Android Chrome the user clicks Install, we fire the deferred prompt,
// and on acceptance we transition the same banner into a "turn on
// notifications" step. Browsers preserve the user-gesture context across
// the await chain, so requestPermission() doesn't get dropped.
// iOS Safari has no JS install prompt — the user goes share-sheet → Add to
// Home Screen, then /welcome catches them on first standalone launch.
export function InstallBanner() {
  const [stage, setStage] = useState<Stage>("hidden");
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [pending, startTransition] = useTransition();
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (isStandalone()) return;
    if (readCookie(DISMISS_COOKIE)) return;

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
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    window.__squadDeferredInstallPrompt = null;
    if (choice.outcome !== "accepted") {
      setStage("hidden");
      setDismissed();
      return;
    }
    // Chain into the notification ask. Permission either already exists
    // (silent re-subscribe) or needs a fresh request via a follow-up tap.
    if (!isPushSupported() || !vapidKey) {
      setStage("hidden");
      setDismissed();
      return;
    }
    if (Notification.permission === "granted") {
      void subscribeAndPersist(vapidKey).catch(() => {});
      setStage("hidden");
      setDismissed();
      return;
    }
    if (Notification.permission === "denied") {
      setStage("hidden");
      setDismissed();
      return;
    }
    setStage("notify");
  };

  const allowNotifications = () => {
    if (!vapidKey) return;
    startTransition(async () => {
      let permission: NotificationPermission;
      try {
        permission = await Notification.requestPermission();
      } catch {
        return;
      }
      if (permission !== "granted") {
        setStage("hidden");
        setDismissed();
        return;
      }
      try {
        await subscribeAndPersist(vapidKey);
        toast.success("Notifications on");
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Couldn't enable notifications.";
        toast.error(msg);
      } finally {
        setStage("hidden");
        setDismissed();
      }
    });
  };

  if (stage === "notify") {
    return (
      <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-coral/30 bg-coral/8 px-3 py-2.5 shadow-sm sm:mx-6">
        <Bell className="size-4 shrink-0 text-coral" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[13px] font-medium text-ink">
            One more thing
          </span>
          <span className="truncate text-xs text-ink-muted">
            Let Squad nudge you when plans drop.
          </span>
        </div>
        <button
          type="button"
          onClick={allowNotifications}
          disabled={pending}
          className="shrink-0 rounded-full bg-coral px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:opacity-50"
        >
          Turn on
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Maybe later"
          className="shrink-0 rounded-full p-1 text-ink-muted hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-ink/10 bg-paper-card px-3 py-2.5 shadow-sm sm:mx-6">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-medium text-ink">
          Install Squad
        </span>
        <span className="truncate text-xs text-ink-muted">
          {stage === "android" ? (
            "Add to your home screen — we'll set up notifications next."
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
