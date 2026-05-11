"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  setPushSubscription,
  clearPushSubscription,
} from "@/lib/actions/push-subscriptions";
import type { PushSubscriptionInput } from "@/lib/validation/push-subscription";

function detectDeviceHint(): "mobile" | "desktop" {
  return /Mobi|Android/i.test(navigator.userAgent) ? "mobile" : "desktop";
}

type Status =
  | "loading"
  | "unsupported"
  | "denied"
  | "off"
  | "on"
  | "no-vapid";

// PushManager.subscribe wants an ArrayBuffer-backed Uint8Array, so we
// allocate the buffer first and write into a view of it.
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

export function PushOptIn({ initiallyOn }: { initiallyOn: boolean }) {
  const [status, setStatus] = useState<Status>("loading");
  const [pending, startTransition] = useTransition();

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (!isPushSupported()) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    if (!vapidKey) {
      setStatus("no-vapid");
      return;
    }
    setStatus(initiallyOn ? "on" : "off");
  }, [initiallyOn, vapidKey]);

  async function enable() {
    if (!vapidKey) return;
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          if (permission === "denied") setStatus("denied");
          return;
        }

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
        await setPushSubscription({
          subscription: json,
          deviceHint: detectDeviceHint(),
        });
        setStatus("on");
        toast.success("Push notifications on");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't enable push.";
        toast.error(msg);
      }
    });
  }

  async function disable() {
    startTransition(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          // Capture endpoint before unsubscribe — Chrome zeroes it out after.
          const endpoint = sub.endpoint;
          await sub.unsubscribe();
          await clearPushSubscription({ endpoint });
        }
        setStatus("off");
        toast.success("Push notifications off");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't disable push.";
        toast.error(msg);
      }
    });
  }

  const helpCopy: Record<Status, string> = {
    loading: "Checking…",
    unsupported:
      "This browser doesn't support push notifications. Try Chrome on Android or Safari on iOS 16.4+.",
    denied:
      "Notifications are blocked in your browser settings — enable them there to turn this on.",
    "no-vapid":
      "Push notifications aren't configured on this server yet.",
    off: "Get a heads-up when a new plan is created or one you're in locks.",
    on: "You'll get a ping for new plans and lock-ins.",
  };

  const isOn = status === "on";
  const canToggle = status === "off" || status === "on";

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 bg-paper-card/40 px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm text-ink">Push notifications</span>
        <span className="text-xs text-ink-muted">{helpCopy[status]}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label="Push notifications"
        disabled={!canToggle || pending}
        onClick={isOn ? disable : enable}
        className={[
          "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral",
          "disabled:cursor-not-allowed disabled:opacity-50",
          isOn
            ? "border-coral bg-coral"
            : "border-ink/15 bg-ink/10",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            isOn ? "translate-x-5" : "translate-x-0",
          ].join(" ")}
        />
      </button>
    </div>
  );
}
