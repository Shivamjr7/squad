"use client";

import { useState, useTransition } from "react";
import { Laptop, Smartphone } from "lucide-react";
import { toast } from "sonner";
import {
  clearPushSubscription,
  setNotificationsEnabled,
} from "@/lib/actions/push-subscriptions";

export type ManageDeviceRow = {
  id: string;
  endpoint: string;
  deviceHint: "mobile" | "desktop" | null;
  lastUsedAt: string | null;
  createdAt: string;
};

function formatRelative(iso: string | null, fallback: string): string {
  const ref = iso ?? fallback;
  const ts = new Date(ref).getTime();
  if (Number.isNaN(ts)) return "Recently";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "Just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ref).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function deviceLabel(hint: "mobile" | "desktop" | null): string {
  if (hint === "mobile") return "Phone";
  if (hint === "desktop") return "Desktop";
  return "Device";
}

// Manage devices (M31.7) — global mute toggle on top, per-device list below.
// The toggle flips `users.notifications_enabled`; `resolvePlanAudience`
// blocks dispatch when it's off, so muted users get neither push nor in-app
// feed rows. Per-device "Remove" deletes a single push_subscriptions row
// without touching the column. Enabling notifications happens at /welcome.
export function ManageDevices({
  devices,
  notificationsEnabled,
}: {
  devices: ManageDeviceRow[];
  notificationsEnabled: boolean;
}) {
  const [rows, setRows] = useState(devices);
  const [enabled, setEnabled] = useState(notificationsEnabled);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toggling, startToggleTransition] = useTransition();

  const disable = (row: ManageDeviceRow) => {
    setPendingId(row.id);
    void (async () => {
      try {
        await clearPushSubscription({ endpoint: row.endpoint });
        setRows((current) => current.filter((r) => r.id !== row.id));
        toast.success("Device removed");
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Couldn't remove device.";
        toast.error(msg);
      } finally {
        setPendingId(null);
      }
    })();
  };

  const toggleMute = () => {
    const next = !enabled;
    // Optimistic flip — speed > polish (CLAUDE.md). Reverted in catch.
    setEnabled(next);
    startToggleTransition(async () => {
      try {
        await setNotificationsEnabled(next);
        toast.success(
          next ? "Notifications on" : "Notifications muted",
        );
      } catch (err) {
        setEnabled(!next);
        const msg =
          err instanceof Error ? err.message : "Couldn't update setting.";
        toast.error(msg);
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-lg border border-ink/10 bg-paper-card/40 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm text-ink">
            All notifications
          </span>
          <span className="text-xs text-ink-muted">
            {enabled
              ? "You'll get pushes + feed updates."
              : "Muted — no pushes, no feed rows."}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Mute all notifications"
          onClick={toggleMute}
          disabled={toggling}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:opacity-60 ${
            enabled ? "bg-coral" : "bg-ink/15"
          }`}
        >
          <span
            className={`inline-block size-5 transform rounded-full bg-paper shadow transition-transform ${
              enabled ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-paper-card/40 px-4 py-4">
          <span className="text-sm text-ink">No devices subscribed</span>
          <p className="text-xs leading-relaxed text-ink-muted">
            Open{" "}
            <a
              href="/welcome"
              className="font-medium text-coral underline-offset-2 hover:underline"
            >
              the setup page
            </a>{" "}
            to enable notifications on this device.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const Icon = row.deviceHint === "desktop" ? Laptop : Smartphone;
            return (
              <li
                key={row.id}
                className="flex items-center gap-3 rounded-lg border border-ink/10 bg-paper-card/40 px-4 py-3"
              >
                <Icon className="size-4 shrink-0 text-ink-muted" aria-hidden />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm text-ink">
                    {deviceLabel(row.deviceHint)}
                  </span>
                  <span className="text-xs text-ink-muted">
                    Last ping {formatRelative(row.lastUsedAt, row.createdAt)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => disable(row)}
                  disabled={pendingId === row.id}
                  className="shrink-0 rounded-full border border-ink/15 px-3 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:opacity-50"
                >
                  {pendingId === row.id ? "Removing…" : "Remove"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
