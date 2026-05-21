"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setPushSubscription } from "@/lib/actions/push-subscriptions";
import type {
  PushSubscriptionInput,
  SubscribePushInput,
} from "@/lib/validation/push-subscription";

// Single localStorage flag — set on mount so the redirector never sends the
// same user here twice. The plan no longer branches by install path
// (NOTIFICATIONS_PLAN.md §4.a): every user hits /welcome on their first
// authed page load and `squad_welcome_seen` records that they did.
const WELCOME_SEEN_KEY = "squad_welcome_seen";

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

type State = "loading" | "unsupported" | "denied" | "ready";

export function WelcomeCta({ fallbackSlug }: { fallbackSlug: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<State>("loading");
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    // Setting the flag here is what makes /welcome a one-shot — once the
    // user lands here, the redirector won't send them back on later visits.
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, "1");
    } catch {
      // Private mode or storage quota — best-effort. Worst case the user
      // sees /welcome twice; the second visit is a no-op once they subscribe.
    }
    if (!isPushSupported() || !vapidKey) {
      setState("unsupported");
      return;
    }
    // Chrome can have permission pre-set to "denied" (previous deny on this
    // origin, quieter-permissions mode, or some incognito configs that auto-
    // reject). Calling requestPermission() in that state returns "denied"
    // instantly without a prompt, which felt broken pre-M31.10. Detect on
    // mount and render the recovery instructions inline instead.
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    setState("ready");
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
          // Flip into the inline recovery panel instead of just toasting —
          // the page stays open so the user can fix it in browser settings
          // and re-land here without re-navigating.
          setState("denied");
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

  if (state === "loading") {
    return <div className="h-12" aria-hidden />;
  }

  if (state === "unsupported") {
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

  if (state === "denied") {
    return (
      <div className="flex flex-col items-center gap-4 text-left">
        <div className="w-full rounded-2xl border border-out/30 bg-out/5 px-5 py-4">
          <p className="text-sm font-medium text-ink">
            Notifications are blocked for this site.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            Your browser denied the permission without prompting — usually
            because notifications were turned off here before, or the browser
            is in a strict mode (incognito or &ldquo;quieter prompts&rdquo;).
          </p>
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">
            To turn them on:
          </p>
          <ol className="mt-1 list-decimal pl-4 text-xs leading-relaxed text-ink-muted">
            <li>
              Click the lock / tune icon next to the URL in the address bar.
            </li>
            <li>
              Set <span className="font-medium text-ink">Notifications</span>{" "}
              to <span className="font-medium text-ink">Allow</span>.
            </li>
            <li>Reload this page and tap the button again.</li>
          </ol>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full rounded-full bg-coral px-7 py-3.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
        >
          Reload and try again
        </button>
        <button
          type="button"
          onClick={skip}
          className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        >
          Continue without notifications
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
