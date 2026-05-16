"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setPushSubscription } from "@/lib/actions/push-subscriptions";
import type {
  PushSubscriptionInput,
  SubscribePushInput,
} from "@/lib/validation/push-subscription";

// Two localStorage flags — both are set on mount so the redirector never
// sends the same user here twice. The first covers iOS standalone first-
// launch; the second covers legacy users (installed before M31) on their
// first authed page-load after the deploy.
const WELCOME_SEEN_KEY = "squad_welcome_seen";
const REVAMP_SEEN_KEY = "squad_notifications_revamp_seen";

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

function isPushSupported(): boolean {
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

export function WelcomeCta({ fallbackSlug }: { fallbackSlug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [unsupported, setUnsupported] = useState(false);
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    // Setting both flags here is what makes /welcome a one-shot — once the
    // user lands here, neither redirector branch fires again on later visits.
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, "1");
      localStorage.setItem(REVAMP_SEEN_KEY, "1");
    } catch {
      // Private mode or storage quota — best-effort. Worst case the user
      // sees /welcome twice; the second visit is a no-op once they subscribe.
    }
    if (!isPushSupported() || !vapidKey) setUnsupported(true);
  }, [vapidKey]);

  const skip = () => router.replace(`/c/${fallbackSlug}`);

  const turnOn = () => {
    if (!vapidKey) return;
    startTransition(async () => {
      let permission: NotificationPermission;
      try {
        permission = await Notification.requestPermission();
      } catch {
        return;
      }
      if (permission !== "granted") {
        if (permission === "denied") {
          toast.error(
            "Notifications are blocked. Enable them in browser settings to turn this on.",
          );
        }
        return;
      }
      try {
        await subscribeAndPersist(vapidKey);
        toast.success("Notifications on");
        router.replace(`/c/${fallbackSlug}`);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Couldn't enable notifications.";
        toast.error(msg);
      }
    });
  };

  if (unsupported) {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="text-xs text-ink-muted">
          This browser doesn&apos;t support push notifications. You can still
          use Squad — try installing on Chrome (Android) or Safari (iOS 16.4+)
          to get plan pings.
        </p>
        <button
          type="button"
          onClick={skip}
          className="rounded-full bg-ink px-7 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={turnOn}
        disabled={pending}
        className="w-full rounded-full bg-coral px-7 py-3.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:opacity-50"
      >
        {pending ? "Turning on…" : "Turn on notifications"}
      </button>
      <button
        type="button"
        onClick={skip}
        disabled={pending}
        className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
      >
        Maybe later
      </button>
    </div>
  );
}
