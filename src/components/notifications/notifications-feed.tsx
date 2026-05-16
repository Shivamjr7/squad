"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  ChevronDown,
  Plus,
} from "lucide-react";
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

function payloadNumber(p: Payload | null, key: string): number | null {
  if (!p) return null;
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function formatShortTime(iso: string | null): string {
  if (!iso) return "soon";
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return "soon";
  }
}

// Deterministic initials-avatar color, matching the Squad Pulse palette so
// the same actor reads the same across surfaces.
const ACTOR_PALETTE = [
  "bg-coral/20 text-coral",
  "bg-in/15 text-in",
  "bg-maybe/25 text-maybe",
  "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  "bg-purple-500/15 text-purple-600 dark:text-purple-300",
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

// Per-type icon + tint, used when there's no specific actor (system events
// like plan_locked / plan_leave_soon / plan_cancelled). vote_in /
// plan_created carry an actor (voterName / creatorName) so they default to
// an initials avatar, falling through to the type icon if the actor name
// is missing.
const TYPE_ICON: Record<
  NotificationType,
  { Icon: typeof Bell; bg: string; fg: string }
> = {
  vote_in: { Icon: CheckCircle2, bg: "bg-in/15", fg: "text-in" },
  plan_created: {
    Icon: Plus,
    bg: "bg-blue-500/15",
    fg: "text-blue-600 dark:text-blue-300",
  },
  plan_reminder: { Icon: Bell, bg: "bg-coral/20", fg: "text-coral" },
  plan_locked: { Icon: CheckCircle2, bg: "bg-in/15", fg: "text-in" },
  plan_leave_soon: { Icon: Bell, bg: "bg-coral/20", fg: "text-coral" },
  plan_cancelled: { Icon: BellOff, bg: "bg-out/15", fg: "text-out" },
  // M32 placeholders. M32.7 wires the real conflict UI; until then no
  // composer writes these kinds, so the entries are reachable only via
  // backfilled rows. Keep them defined so Record<NotificationType, …>
  // exhaustiveness holds.
  plan_conflict: { Icon: Bell, bg: "bg-coral/20", fg: "text-coral" },
  plan_conflict_resolved: { Icon: Bell, bg: "bg-in/15", fg: "text-in" },
};

type Decoded = {
  actor: string | null;
  actorSeed: string | null;
  // OS-quote-voice body, per M31 NOTIFICATIONS_PLAN §3 / §7. The composer
  // intentionally returns a plain string so the feed can prefix the actor
  // name as a separate bold span without HTML-soup.
  bodyText: string;
  href: string | null;
  circleSlug: string | null;
  circleName: string | null;
  // OS-level collapse key. Mirrors composePushPayload's `tag` per kind so
  // the in-app feed groups the same way the push shade collapses.
  tag: string;
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
      const startsAtIso = payloadString(p, "startsAtIso");
      const when = startsAtIso ? formatShortTime(startsAtIso) : null;
      // Quote voice: "Karan: in for 8:30" or "Karan: in for Movie night".
      return {
        actor: name,
        actorSeed: seed,
        bodyText: when ? `in for ${when}` : `in for ${planTitle}`,
        href,
        circleSlug: slug,
        circleName,
        tag: planId ? `plan:${planId}:votes` : `row:${row.id}`,
      };
    }
    case "plan_created": {
      const name = payloadString(p, "creatorName") ?? "Someone";
      const seed = payloadString(p, "creatorId") ?? name;
      // "Mira started a plan · Movie night" — body without actor; the
      // renderer prepends "Mira" as a bold span.
      return {
        actor: name,
        actorSeed: seed,
        bodyText: `started a plan · ${planTitle}`,
        href,
        circleSlug: slug,
        circleName,
        tag: planId ? `plan:${planId}:created` : `row:${row.id}`,
      };
    }
    case "plan_locked": {
      const startsAt = payloadString(p, "startsAtIso");
      const location = payloadString(p, "location");
      const when = formatShortTime(startsAt);
      const where = location?.trim() || planTitle;
      return {
        actor: null,
        actorSeed: null,
        bodyText: `It's happening — ${when} at ${where}`,
        href,
        circleSlug: slug,
        circleName,
        tag: planId ? `plan:${planId}:state` : `row:${row.id}`,
      };
    }
    case "plan_leave_soon": {
      const location = payloadString(p, "location");
      const raw = payloadNumber(p, "minutesUntilStart") ?? 45;
      const minutes = Math.max(5, Math.round(raw / 5) * 5);
      const where = location?.trim();
      return {
        actor: null,
        actorSeed: null,
        bodyText: where
          ? `Leave in ~${minutes}m · ${where}`
          : `Leave in ~${minutes}m`,
        href,
        circleSlug: slug,
        circleName,
        tag: planId ? `plan:${planId}:leave` : `row:${row.id}`,
      };
    }
    case "plan_cancelled": {
      return {
        actor: null,
        actorSeed: null,
        bodyText: `Plan off — ${planTitle} cancelled`,
        href,
        circleSlug: slug,
        circleName,
        tag: planId ? `plan:${planId}:state` : `row:${row.id}`,
      };
    }
    case "plan_reminder": {
      // Legacy back-compat for rows already in the table — no new triggers
      // fire this kind in M31+, but the composer keeps the shape.
      const startsAt = payloadString(p, "startsAtIso");
      return {
        actor: null,
        actorSeed: null,
        bodyText: `${planTitle} · Starts at ${formatShortTime(startsAt)}`,
        href,
        circleSlug: slug,
        circleName,
        tag: planId ? `plan:${planId}:reminder` : `row:${row.id}`,
      };
    }
    // M32 placeholders. No composer writes these yet (M32.7 does the wiring);
    // keep the switch exhaustive so the schema can land first.
    case "plan_conflict":
    case "plan_conflict_resolved": {
      return {
        actor: null,
        actorSeed: null,
        bodyText: planTitle,
        href,
        circleSlug: slug,
        circleName,
        tag: planId ? `plan:${planId}:conflict` : `row:${row.id}`,
      };
    }
  }
}

// ─── Tag-based grouping ──────────────────────────────────────────────────
// vote_in bursts collapse into a single row to mirror the OS shade behavior
// (composePushPayload sets renotify=false for the same tag so Android /
// iOS only show one bubble). Other kinds pass through as singletons even
// when they happen to share a tag (e.g. plan_locked → plan_cancelled on the
// same `:state` tag) — those are genuinely different states the user wants
// to see distinctly.

type FeedItem =
  | { kind: "single"; row: NotificationRow; decoded: Decoded }
  | {
      kind: "group";
      key: string;
      tag: string;
      rows: NotificationRow[];
      decoded: Decoded[];
    };

function buildFeedItems(rows: NotificationRow[]): FeedItem[] {
  const items: FeedItem[] = [];
  // Walk in display order (newest → oldest, as returned by the action). A
  // run is a maximal stretch of same-tag vote_in rows.
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    const decoded = decode(row);
    if (row.type === "vote_in" && decoded.tag.startsWith("plan:")) {
      let j = i + 1;
      const groupRows: NotificationRow[] = [row];
      const groupDecoded: Decoded[] = [decoded];
      while (j < rows.length) {
        const next = rows[j]!;
        if (next.type !== "vote_in") break;
        const nextDecoded = decode(next);
        if (nextDecoded.tag !== decoded.tag) break;
        groupRows.push(next);
        groupDecoded.push(nextDecoded);
        j += 1;
      }
      if (groupRows.length > 1) {
        items.push({
          kind: "group",
          // Stable key: tag + earliest id keeps React identity steady even
          // when newer votes prepend more rows on a refetch.
          key: `${decoded.tag}:${groupRows[groupRows.length - 1]!.id}`,
          tag: decoded.tag,
          rows: groupRows,
          decoded: groupDecoded,
        });
      } else {
        items.push({ kind: "single", row, decoded });
      }
      i = j;
      continue;
    }
    items.push({ kind: "single", row, decoded });
    i += 1;
  }
  return items;
}

// Build the collapsed-row label for a vote_in group. Unique actors only —
// the trigger only fires on the IN edge per user, so duplicates are rare,
// but defensive de-dupe keeps the count honest if it ever happens.
function groupedActorLine(decoded: Decoded[]): string {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const d of decoded) {
    if (!d.actor) continue;
    const key = d.actorSeed ?? d.actor;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(d.actor);
  }
  if (ordered.length === 0) return "are in";
  if (ordered.length === 1) return `is in`;
  if (ordered.length === 2) return `and ${ordered[1]} are in`;
  return `+ ${ordered.length - 1} others are in`;
}

function groupedAvatars(decoded: Decoded[]): Decoded[] {
  const seen = new Set<string>();
  const ordered: Decoded[] = [];
  for (const d of decoded) {
    const key = d.actorSeed ?? d.actor ?? d.bodyText;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(d);
  }
  return ordered.slice(0, 3);
}

export function NotificationsFeed({
  initialRows,
}: {
  initialRows: NotificationRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const unreadCount = rows.filter((r) => !r.readAt).length;
  const feedItems = useMemo(() => buildFeedItems(rows), [rows]);

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

  function toggleGroup(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
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
        {feedItems.map((item) => {
          if (item.kind === "single") {
            return (
              <FeedRow
                key={item.row.id}
                row={item.row}
                decoded={item.decoded}
                onClick={() => handleClickRow(item.row.id)}
              />
            );
          }
          const isExpanded = expanded.has(item.key);
          const anyUnread = item.rows.some((r) => r.readAt === null);
          const newest = item.rows[0]!;
          return (
            <li key={item.key} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => toggleGroup(item.key)}
                aria-expanded={isExpanded}
                className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                <div
                  className={cn(
                    "relative flex items-start gap-3 rounded-xl px-3 py-3 transition-colors",
                    anyUnread
                      ? "bg-paper-card"
                      : "bg-transparent hover:bg-paper-card/50",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute top-1/2 left-1 size-2 -translate-y-1/2 rounded-full bg-coral transition-opacity duration-300",
                      anyUnread ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <GroupedAvatarStack decoded={groupedAvatars(item.decoded)} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 text-sm leading-snug text-ink-muted">
                        <span className="font-semibold text-ink">
                          {item.decoded[0]?.actor ?? "Someone"}
                        </span>{" "}
                        {groupedActorLine(item.decoded)}
                      </p>
                      <span
                        className="shrink-0 text-xs tabular-nums text-ink-muted"
                        aria-label={newest.createdAt.toLocaleString()}
                      >
                        {compactRelative(newest.createdAt)}
                      </span>
                    </div>
                    <CircleChip
                      slug={item.decoded[0]?.circleSlug ?? null}
                      name={item.decoded[0]?.circleName ?? null}
                    />
                  </div>
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 self-center text-ink-muted transition-transform duration-200",
                      isExpanded ? "rotate-180" : "rotate-0",
                    )}
                  />
                </div>
              </button>
              {isExpanded ? (
                <ul className="ml-3 flex flex-col gap-1 border-l border-ink-subtle pl-2">
                  {item.rows.map((row, idx) => (
                    <FeedRow
                      key={row.id}
                      row={row}
                      decoded={item.decoded[idx]!}
                      onClick={() => handleClickRow(row.id)}
                      compact
                    />
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FeedRow({
  row,
  decoded,
  onClick,
  compact = false,
}: {
  row: NotificationRow;
  decoded: Decoded;
  onClick: () => void;
  compact?: boolean;
}) {
  const isUnread = row.readAt === null;
  const typeIcon = TYPE_ICON[row.type];
  const inner = (
    <div
      className={cn(
        "relative flex items-start gap-3 rounded-xl px-3 py-3 transition-colors",
        compact ? "py-2" : "py-3",
        isUnread ? "bg-paper-card" : "bg-transparent hover:bg-paper-card/50",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 left-1 size-2 -translate-y-1/2 rounded-full bg-coral transition-opacity duration-300",
          isUnread ? "opacity-100" : "opacity-0",
        )}
      />

      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full",
          compact ? "size-7" : "size-9",
          decoded.actor && decoded.actorSeed
            ? actorColor(decoded.actorSeed)
            : `${typeIcon.bg} ${typeIcon.fg}`,
        )}
        aria-hidden
      >
        {decoded.actor && decoded.actorSeed ? (
          <span
            className={cn(
              "font-semibold uppercase",
              compact ? "text-[11px]" : "text-sm",
            )}
          >
            {initial(decoded.actor)}
          </span>
        ) : (
          <typeIcon.Icon className={cn(compact ? "size-3.5" : "size-4")} />
        )}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-2">
          <p
            className={cn(
              "min-w-0 flex-1 leading-snug text-ink-muted",
              compact ? "text-[13px]" : "text-sm",
            )}
          >
            {decoded.actor ? (
              <>
                <span className="font-semibold text-ink">{decoded.actor}</span>
                <span aria-hidden>: </span>
              </>
            ) : null}
            {decoded.bodyText}
          </p>
          <span
            className={cn(
              "shrink-0 tabular-nums text-ink-muted",
              compact ? "text-[11px]" : "text-xs",
            )}
            aria-label={row.createdAt.toLocaleString()}
          >
            {compactRelative(row.createdAt)}
          </span>
        </div>
        {!compact ? (
          <CircleChip slug={decoded.circleSlug} name={decoded.circleName} />
        ) : null}
      </div>
    </div>
  );

  if (decoded.href) {
    return (
      <li>
        <Link
          href={decoded.href}
          onClick={onClick}
          prefetch={false}
          className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          {inner}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        {inner}
      </button>
    </li>
  );
}

function CircleChip({
  slug,
  name,
}: {
  slug: string | null;
  name: string | null;
}) {
  if (!slug || !name) return null;
  return (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-paper px-2 py-0.5 text-[11px] text-ink-muted ring-1 ring-ink-subtle">
      <span aria-hidden className={cn("size-1.5 rounded-full", circleDotClass(slug))} />
      <span className="truncate font-medium text-ink/80">{name}</span>
    </span>
  );
}

function GroupedAvatarStack({ decoded }: { decoded: Decoded[] }) {
  return (
    <span className="flex shrink-0 -space-x-2">
      {decoded.map((d, idx) => {
        const seed = d.actorSeed ?? d.actor ?? `idx-${idx}`;
        return (
          <span
            key={seed}
            className={cn(
              "flex size-8 items-center justify-center rounded-full text-sm font-semibold uppercase ring-2 ring-paper",
              actorColor(seed),
            )}
            aria-hidden
          >
            {initial(d.actor)}
          </span>
        );
      })}
    </span>
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
