"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronRight, Check } from "lucide-react";
import {
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
  type NotificationType,
} from "@/lib/actions/notifications";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<NotificationType, string> = {
  vote_in: "voted in",
  plan_created: "new plan",
  plan_reminder: "reminder",
};

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

type Payload = Record<string, unknown>;

function payloadString(p: Payload | null, key: string): string | null {
  if (!p) return null;
  const v = p[key];
  return typeof v === "string" ? v : null;
}

function renderCopy(row: NotificationRow): {
  headline: string;
  detail: string | null;
  href: string | null;
} {
  const p = row.payload ?? null;
  const slug = payloadString(p, "circleSlug");
  const planId = payloadString(p, "planId");
  const planTitle = payloadString(p, "planTitle") ?? "this plan";
  const href = slug && planId ? `/c/${slug}/p/${planId}` : null;
  switch (row.type) {
    case "vote_in": {
      const name = payloadString(p, "voterName") ?? "Someone";
      return {
        headline: `${name} is in for ${planTitle}.`,
        detail: payloadString(p, "circleName"),
        href,
      };
    }
    case "plan_created": {
      const name = payloadString(p, "creatorName") ?? "Someone";
      return {
        headline: `${name} started a new plan — ${planTitle}.`,
        detail: payloadString(p, "circleName"),
        href,
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
      const where = payloadString(p, "location");
      return {
        headline: `${planTitle} starts at ${when}.`,
        detail: where ?? payloadString(p, "circleName"),
        href,
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

  // Mark everything as read the moment the inbox is mounted — the act of
  // viewing the feed is the "I've seen these" signal. Optimistic locally;
  // server call is non-blocking; router.refresh() once it resolves so the
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
    // Auto-mark-all already swept this row when the inbox mounted, so the
    // common case is a no-op — skip the server action entirely. Only fire
    // if we somehow have an unread row (e.g. one that arrived after mount).
    if (current?.readAt) return;
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, readAt: new Date() } : r)),
    );
    startTransition(async () => {
      try {
        await markNotificationRead(id);
        router.refresh();
      } catch {
        // Best effort — leave the row as read; reconciliation on next load.
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
    return (
      <div className="rounded-lg border border-dashed border-ink/10 bg-paper-card/40 px-4 py-12 text-center">
        <p className="text-base font-semibold text-ink">No notifications yet</p>
        <p className="mt-1 text-sm text-ink-muted">
          You&rsquo;ll hear here when a plan kicks off or someone&rsquo;s in.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          {unreadCount > 0
            ? `${unreadCount} unread`
            : "All caught up."}
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
          const { headline, detail, href } = renderCopy(row);
          const isUnread = row.readAt === null;
          const inner = (
            <div
              className={cn(
                "flex items-start gap-3 rounded-lg border border-ink/10 bg-paper-card/40 px-4 py-3 transition-colors",
                isUnread ? "bg-coral/5" : "",
              )}
            >
              {isUnread ? (
                <span
                  aria-hidden
                  className="mt-1.5 inline-block size-2 shrink-0 rounded-full bg-coral"
                />
              ) : (
                <span aria-hidden className="mt-1.5 inline-block size-2 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">{headline}</p>
                {detail ? (
                  <p className="mt-0.5 text-xs text-ink-muted">{detail}</p>
                ) : null}
                <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                  {TYPE_LABEL[row.type]} · {relativeTime(row.createdAt)}
                </p>
              </div>
              {href ? (
                <ChevronRight
                  className="mt-1 size-4 shrink-0 text-ink-muted"
                  aria-hidden
                />
              ) : null}
            </div>
          );
          if (href) {
            return (
              <li key={row.id}>
                <Link
                  href={href}
                  onClick={() => handleClickRow(row.id)}
                  prefetch={false}
                  className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
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
                className="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
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
