"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bell, Check, Plus, ThumbsUp } from "lucide-react";
import {
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
  type NotificationType,
} from "@/lib/actions/notifications";
import { cn } from "@/lib/utils";
import { circleDotClass } from "@/lib/circle-color";

// Compact relative — "2m" / "1h" / "3d" / "Jan 4" — matches Instagram /
// WhatsApp notification list style.
function compactRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type Payload = Record<string, unknown>;

function payloadString(p: Payload | null, key: string): string | null {
  if (!p) return null;
  const v = p[key];
  return typeof v === "string" ? v : null;
}

// Deterministic initials-avatar color, matching the Squad Pulse palette so
// the same actor reads the same across surfaces. Bright text variants for
// the dark theme.
const ACTOR_PALETTE = [
  "bg-coral/20 text-coral",
  "bg-in/15 text-in",
  "bg-maybe/25 text-maybe",
  "bg-blue-500/15 text-blue-300",
  "bg-purple-500/15 text-purple-300",
] as const;

function actorColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return ACTOR_PALETTE[hash % ACTOR_PALETTE.length]!;
}

function initial(name: string | null | undefined): string {
  if (!name) return "?";
  const t = name.trim();
  return t.length === 0 ? "?" : t[0]!.toUpperCase();
}

// Per-type icon + tint, used when there's no specific actor (system
// notifications like plan_reminder). vote_in / plan_created carry an
// actor (voterName / creatorName), so they default to an initials avatar
// but fall through to the icon if the actor name is missing.
const TYPE_ICON: Record<
  NotificationType,
  { Icon: typeof Bell; bg: string; fg: string }
> = {
  vote_in: { Icon: ThumbsUp, bg: "bg-in/15", fg: "text-in" },
  plan_created: { Icon: Plus, bg: "bg-blue-500/15", fg: "text-blue-300" },
  plan_reminder: { Icon: Bell, bg: "bg-coral/20", fg: "text-coral" },
};

type Decoded = {
  actor: string | null;
  actorSeed: string | null;
  body: React.ReactNode;
  href: string | null;
  circleSlug: string | null;
  circleName: string | null;
};

function decode(row: NotificationRow): Decoded {
  const p = row.payload ?? null;
  const slug = payloadString(p, "circleSlug");
  const planId = payloadString(p, "planId");
  const planTitle = payloadString(p, "planTitle") ?? "this plan";
  const circleName = payloadString(p, "circleName");
  const href = slug && planId ? `/c/${slug}/p/${planId}` : null;

  switch (row.type) {
    case "vote_in": {
      const name = payloadString(p, "voterName") ?? "Someone";
      const seed = payloadString(p, "voterId") ?? name;
      return {
        actor: name,
        actorSeed: seed,
        body: (
          <>
            is in for <span className="font-medium text-ink">{planTitle}</span>.
          </>
        ),
        href,
        circleSlug: slug,
        circleName,
      };
    }
    case "plan_created": {
      const name = payloadString(p, "creatorName") ?? "Someone";
      const seed = payloadString(p, "creatorId") ?? name;
      return {
        actor: name,
        actorSeed: seed,
        body: (
          <>
            started a new plan ·{" "}
            <span className="font-medium text-ink">{planTitle}</span>
          </>
        ),
        href,
        circleSlug: slug,
        circleName,
      };
    }
    case "plan_reminder": {
      const iso = payloadString(p, "startsAtIso");
      let when = "soon";
      if (iso) {
        try {
          when = new Intl.DateTimeFormat(undefined, {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }).format(new Date(iso));
        } catch {
          when = "soon";
        }
      }
      return {
        actor: null,
        actorSeed: null,
        body: (
          <>
            <span className="font-medium text-ink">{planTitle}</span> starts at{" "}
            {when}.
          </>
        ),
        href,
        circleSlug: slug,
        circleName,
      };
    }
  }
}

export function NotificationsFeed({
  initialRows,
}: {
  initialRows: NotificationRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [pending, startTransition] = useTransition();

  const unreadCount = rows.filter((r) => !r.readAt).length;

  // Auto-mark-all when the inbox mounts — viewing the feed IS the
  // "I've seen these" signal. Optimistic locally; server call is
  // non-blocking; router.refresh() once it resolves so the
  // server-rendered Sidebar badge re-fetches its unread count.
  const didAutoMark = useRef(false);
  useEffect(() => {
    if (didAutoMark.current) return;
    didAutoMark.current = true;
    const anyUnread = initialRows.some((r) => !r.readAt);
    if (!anyUnread) return;
    setRows((prev) =>
      prev.map((r) => (r.readAt ? r : { ...r, readAt: new Date() })),
    );
    void (async () => {
      try {
        await markAllNotificationsRead();
        router.refresh();
      } catch {
        // Best effort — next nav will reconcile.
      }
    })();
  }, [initialRows, router]);

  function handleClickRow(id: string) {
    const current = rows.find((r) => r.id === id);
    if (current?.readAt) return;
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, readAt: new Date() } : r)),
    );
    startTransition(async () => {
      try {
        await markNotificationRead(id);
        router.refresh();
      } catch {
        // Best effort.
      }
    });
  }

  function handleMarkAll() {
    setRows((prev) => prev.map((r) => (r.readAt ? r : { ...r, readAt: new Date() })));
    startTransition(async () => {
      try {
        await markAllNotificationsRead();
        router.refresh();
      } catch {
        // Best effort.
      }
    });
  }

  if (rows.length === 0) {
    return <NotificationsEmpty />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          {unreadCount > 0 ? `${unreadCount} unread` : "All caught up."}
        </p>
        {unreadCount > 0 ? (
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="size-3.5" aria-hidden />
            Mark all read
          </button>
        ) : null}
      </div>

      <ul className="flex flex-col gap-1">
        {rows.map((row) => {
          const d = decode(row);
          const isUnread = row.readAt === null;
          const typeIcon = TYPE_ICON[row.type];
          const inner = (
            <div
              className={cn(
                "relative flex items-start gap-3 rounded-xl px-3 py-3 transition-colors",
                isUnread
                  ? "bg-paper-card"
                  : "bg-transparent hover:bg-paper-card/50",
              )}
            >
              {/* Unread accent dot — opacity-driven so the read transition
                  is a smooth fade (300ms) rather than a hard pop. */}
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute top-1/2 left-1 size-2 -translate-y-1/2 rounded-full bg-coral transition-opacity duration-300",
                  isUnread ? "opacity-100" : "opacity-0",
                )}
              />

              {/* Avatar — initials for an actor, icon for a system event. */}
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full pl-0",
                  d.actor && d.actorSeed
                    ? actorColor(d.actorSeed)
                    : `${typeIcon.bg} ${typeIcon.fg}`,
                )}
                aria-hidden
              >
                {d.actor && d.actorSeed ? (
                  <span className="text-sm font-semibold uppercase">
                    {initial(d.actor)}
                  </span>
                ) : (
                  <typeIcon.Icon className="size-4" />
                )}
              </span>

              {/* Body — bold actor name + action; optional circle chip below */}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-sm leading-snug text-ink-muted">
                    {d.actor ? (
                      <>
                        <span className="font-semibold text-ink">
                          {d.actor}
                        </span>{" "}
                      </>
                    ) : null}
                    {d.body}
                  </p>
                  <span
                    className="shrink-0 text-xs tabular-nums text-ink-muted"
                    aria-label={row.createdAt.toLocaleString()}
                  >
                    {compactRelative(row.createdAt)}
                  </span>
                </div>

                {d.circleSlug && d.circleName ? (
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-paper px-2 py-0.5 text-[11px] text-ink-muted ring-1 ring-ink-subtle">
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 rounded-full",
                        circleDotClass(d.circleSlug),
                      )}
                    />
                    <span className="truncate font-medium text-ink/80">
                      {d.circleName}
                    </span>
                  </span>
                ) : null}
              </div>
            </div>
          );

          if (d.href) {
            return (
              <li key={row.id}>
                <Link
                  href={d.href}
                  onClick={() => handleClickRow(row.id)}
                  prefetch={false}
                  className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                >
                  {inner}
                </Link>
              </li>
            );
          }
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => handleClickRow(row.id)}
                className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                {inner}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// SVG-dots empty state — mirrors the Squad brandmark (three dots in a
// triangle) for visual coherence with the favicon / sidebar logo.
function NotificationsEmpty() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-ink-subtle bg-paper-card/40 px-6 py-14 text-center">
      <svg
        viewBox="0 0 64 64"
        aria-hidden
        className="size-16 text-coral/70"
        fill="currentColor"
      >
        <circle cx="32" cy="14" r="5" />
        <circle cx="14" cy="46" r="5" opacity="0.6" />
        <circle cx="50" cy="46" r="5" opacity="0.3" />
        <path
          d="M 32 14 L 14 46 L 50 46 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity="0.2"
        />
      </svg>
      <p className="text-base font-medium text-ink">You&rsquo;re all caught up.</p>
      <p className="text-xs text-ink-muted">
        Notifications from your circles will appear here.
      </p>
    </div>
  );
}
