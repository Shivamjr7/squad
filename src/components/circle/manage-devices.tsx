"use client";

import { useState, useTransition } from "react";
import { Laptop, Smartphone, BellOff } from "lucide-react";
import { toast } from "sonner";
import {
  clearAllMyPushSubscriptions,
  clearPushSubscription,
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

// Manage devices (M31.7) — replaces the M30 single push toggle. Lists every
// push_subscriptions row owned by the user with per-row disable + a global
// mute. Enabling notifications happens at the install moment (banner +
// /welcome), so there's intentionally no "Enable" CTA here. If a user has
// nothing in the list we point them at /welcome.
export function ManageDevices({ devices }: { devices: ManageDeviceRow[] }) {
  const [rows, setRows] = useState(devices);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [muting, startMuteTransition] = useTransition();

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

  const muteAll = () => {
    startMuteTransition(async () => {
      try {
        await clearAllMyPushSubscriptions();
        setRows([]);
        toast.success("All devices muted");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't mute.";
        toast.error(msg);
      }
    });
  };

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-paper-card/40 px-4 py-4">
        <span className="text-sm text-ink">No devices subscribed</span>
        <p className="text-xs leading-relaxed text-ink-muted">
          Notifications turn on when you install Squad. Open{" "}
          <a
            href="/welcome"
            className="font-medium text-coral underline-offset-2 hover:underline"
          >
            the setup page
          </a>{" "}
          to enable them on this device.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
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
                disabled={pendingId === row.id || muting}
                className="shrink-0 rounded-full border border-ink/15 px-3 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:opacity-50"
              >
                {pendingId === row.id ? "Removing…" : "Remove"}
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={muteAll}
        disabled={muting || pendingId !== null}
        className="flex items-center justify-center gap-2 self-start rounded-full px-3 py-1.5 text-xs text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:opacity-50"
      >
        <BellOff className="size-3.5" aria-hidden />
        {muting ? "Muting…" : "Mute all devices"}
      </button>
    </div>
  );
}
