"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Bell, X } from "lucide-react";
import { toast } from "sonner";
import { setPushSubscription } from "@/lib/actions/push-subscriptions";
import type {
  PushSubscriptionInput,
  SubscribePushInput,
} from "@/lib/validation/push-subscription";

const DISMISS_KEY = "squad_push_prompt_dismissed";

function detectDeviceHint(): "mobile" | "desktop" {
  return /Mobi|Android/i.test(navigator.userAgent) ? "mobile" : "desktop";
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

function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
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

// Surfaces the push opt-in immediately on the circle home so users don't have
// to dig into /you to enable. Three branches keyed off the browser's current
// permission state:
//   "granted" + no row → silently subscribe this device (e.g. permission was
//     granted on another tab/install; we just need to register this endpoint)
//   "default" → render an "Enable" CTA. requestPermission() must run inside
//     the click handler synchronously to keep user-gesture context.
//   "denied" or VAPID missing → render nothing.
export function EnablePushBanner({
  hasAnySubscription,
}: {
  hasAnySubscription: boolean;
}) {
  const [stage, setStage] = useState<"hidden" | "prompt">("hidden");
  const [pending, startTransition] = useTransition();
  const autoSubscribedRef = useRef(false);
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (!vapidKey) return;
    if (!isSupported()) return;
    if (hasAnySubscription) return;

    if (Notification.permission === "denied") return;

    if (Notification.permission === "granted") {
      if (autoSubscribedRef.current) return;
      autoSubscribedRef.current = true;
      void subscribeAndPersist(vapidKey).catch(() => {
        // Silent — user already opted in elsewhere, don't badger with toasts.
      });
      return;
    }

    if (typeof window !== "undefined" && localStorage.getItem(DISMISS_KEY)) {
      return;
    }
    setStage("prompt");
  }, [hasAnySubscription, vapidKey]);

  if (stage === "hidden") return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setStage("hidden");
  };

  const enable = async () => {
    if (!vapidKey) return;
    let permission: NotificationPermission;
    try {
      permission = await Notification.requestPermission();
    } catch {
      return;
    }
    if (permission !== "granted") {
      if (permission === "denied") setStage("hidden");
      return;
    }
    startTransition(async () => {
      try {
        await subscribeAndPersist(vapidKey);
        toast.success("Notifications on");
        setStage("hidden");
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Couldn't enable notifications.";
        toast.error(msg);
      }
    });
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-coral/30 bg-coral/8 px-3 py-2.5 sm:px-4">
      <Bell className="size-4 shrink-0 text-coral" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-medium text-ink">
          Get plan pings
        </span>
        <span className="truncate text-xs text-ink-muted">
          One tap and we&apos;ll let you know when plans drop or lock.
        </span>
      </div>
      <button
        type="button"
        onClick={enable}
        disabled={pending}
        className="shrink-0 rounded-full bg-coral px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:opacity-50"
      >
        Enable
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-full p-1 text-ink-muted hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
