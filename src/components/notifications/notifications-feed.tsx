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

// Plan's IANA zone — written into every M31+ payload alongside startsAtIso
// (see src/lib/notifications-payload.ts). When a payload is missing it (legacy
// rows, or a stale dispatch path that didn't persist the field) we fall back
// to the viewer's local zone rather than UTC — this surface runs in the
// browser, so the viewer's zone is the closest reasonable approximation of
// the plan creator's wall clock for a friend-group app where everyone tends
// to be co-located.
function payloadTimeZone(p: Payload | null): string | undefined {
  if (!p) return undefined;
  const v = p["timeZone"];
  if (typeof v === "string" && v.length > 0 && v !== "UTC") return v;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function formatShortTime(iso: string | null, timeZone: string | undefined): string {
  if (!iso) return "soon";
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
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
  // Primary line — bold, sets the moment. "It's happening", "Karan is in".
  primary: string;
  // Secondary line — muted, supplies the supporting detail (time + venue,
  // plan title, vote tally). Null = no second line; row collapses to one
  // text row.
  secondary: string | null;
  // Optional rightmost pill ("2 of 2 in", "~45m"). Renders next to the
  // relative-time stamp when present.
  meta: string | null;
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
      const tz = payloadTimeZone(p);
      const when = startsAtIso ? formatShortTime(startsAtIso, tz) : null;
      return {
        actor: name,
        actorSeed: seed,
        primary: `${name} is in`,
        secondary: when ? `${when} · ${planTitle}` : planTitle,
        meta: null,
        href,
        circleSlug: slug,
        circleName,
        tag: planId ? `plan:${planId}:votes` : `row:${row.id}`,
      };
    }
    case "plan_created": {
      const name = payloadString(p, "creatorName") ?? "Someone";
      const seed = payloadString(p, "creatorId") ?? name;
      return {
        actor: name,
        actorSeed: seed,
        primary: `${name} started a plan`,
        secondary: planTitle,
        meta: null,
        href,
        circleSlug: slug,
        circleName,
        tag: planId ? `plan:${planId}:created` : `row:${row.id}`,
      };
    }
    case "plan_locked": {
      const startsAt = payloadString(p, "startsAtIso");
      const location = payloadString(p, "location");
      const when = formatShortTime(startsAt, payloadTimeZone(p));
      const where = location?.trim();
      const inCount = payloadNumber(p, "inCount");
      const total = payloadNumber(p, "totalRecipients");
      const tally =
        inCount != null && total != null ? `${inCount} of ${total} in` : null;
      const secondaryParts = [when, where].filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      );
      return {
        actor: null,
        actorSeed: null,
        primary: `It's happening · ${planTitle}`,
        secondary:
          secondaryParts.length > 0 ? secondaryParts.join(" · ") : null,
        meta: tally,
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
        primary: `Leave soon · ${planTitle}`,
        secondary: where ? `~${minutes}m to ${where}` : `~${minutes}m until you go`,
        meta: null,
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
        primary: `Plan off · ${planTitle}`,
        secondary: "Cancelled",
        meta: null,
        href,
        circleSlug: slug,
        circleName,
        tag: planId ? `plan:${planId}:state` : `row:${row.id}`,
      };
    }
    case "plan_reminder": {
      const startsAt = payloadString(p, "startsAtIso");
      return {
        actor: null,
        actorSeed: null,
        primary: planTitle,
        secondary: `Starts at ${formatShortTime(startsAt, payloadTimeZone(p))}`,
        meta: null,
        href,
        circleSlug: slug,
        circleName,
        tag: planId ? `plan:${planId}:reminder` : `row:${row.id}`,
      };
    }
    case "plan_conflict": {
      const otherTitle = payloadString(p, "otherPlanTitle") ?? "another plan";
      const otherCircle = payloadString(p, "otherCircleName");
      const otherPlanId = payloadString(p, "otherPlanId");
      const tail = otherCircle ? ` in ${otherCircle}` : "";
      const compareHref =
        href && otherPlanId ? `${href}?conflictWith=${otherPlanId}` : href;
      return {
        actor: null,
        actorSeed: null,
        primary: "Heads up — plans clash",
        secondary: `${planTitle} ↔ ${otherTitle}${tail}`,
        meta: null,
        href: compareHref,
        circleSlug: slug,
        circleName,
        tag: planId ? `plan:${planId}:conflict:${row.id}` : `row:${row.id}`,
      };
    }
    case "plan_conflict_resolved": {
      const otherTitle = payloadString(p, "otherPlanTitle") ?? "another plan";
      return {
        actor: null,
        actorSeed: null,
        primary: "Sorted",
        secondary: `${planTitle} and ${otherTitle} no longer clash`,
        meta: null,
        href,
        circleSlug: slug,
        circleName,
        tag: planId ? `plan:${planId}:conflict:${row.id}` : `row:${row.id}`,
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
function groupedPrimaryLine(decoded: Decoded[]): string {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const d of decoded) {
    if (!d.actor) continue;
    const key = d.actorSeed ?? d.actor;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(d.actor);
  }
  if (ordered.length === 0) return "Someone is in";
  if (ordered.length === 1) return `${ordered[0]} is in`;
  if (ordered.length === 2) return `${ordered[0]} & ${ordered[1]} are in`;
  return `${ordered[0]} + ${ordered.length - 1} others are in`;
}

function groupedAvatars(decoded: Decoded[]): Decoded[] {
  const seen = new Set<string>();
  const ordered: Decoded[] = [];
  for (const d of decoded) {
    const key = d.actorSeed ?? d.actor ?? d.primary;
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {unreadCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-coral/15 px-2.5 py-1 text-xs font-semibold text-coral">
              <span className="size-1.5 rounded-full bg-coral" aria-hidden />
              {unreadCount} new
            </span>
          ) : (
            <span className="text-xs font-medium text-ink-muted">
              All caught up
            </span>
          )}
        </div>
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

      <ul className="flex flex-col gap-1.5">
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
          const groupPrimary = groupedPrimaryLine(item.decoded);
          const firstSecondary = item.decoded[0]?.secondary ?? null;
          return (
            <li key={item.key} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => toggleGroup(item.key)}
                aria-expanded={isExpanded}
                className="block w-full rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                <div
                  className={cn(
                    "relative flex items-start gap-3 rounded-2xl px-3 py-3 transition-colors",
                    anyUnread
                      ? "bg-paper-card ring-1 ring-ink-subtle/60"
                      : "bg-transparent hover:bg-paper-card/50",
                  )}
                >
                  {anyUnread ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute top-3 left-1 size-2 rounded-full bg-coral"
                    />
                  ) : null}
                  <GroupedAvatarStack decoded={groupedAvatars(item.decoded)} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-ink">
                        {groupPrimary}
                      </p>
                      <span
                        className="shrink-0 text-[11px] font-medium tabular-nums text-ink-muted"
                        aria-label={newest.createdAt.toLocaleString()}
                        suppressHydrationWarning
                      >
                        {compactRelative(newest.createdAt)}
                      </span>
                    </div>
                    {firstSecondary ? (
                      <p className="truncate text-[13px] leading-snug text-ink-muted">
                        {firstSecondary}
                      </p>
                    ) : null}
                    <div className="mt-1 flex items-center gap-2">
                      <CircleChip
                        slug={item.decoded[0]?.circleSlug ?? null}
                        name={item.decoded[0]?.circleName ?? null}
                      />
                      <span className="ml-auto text-[11px] font-medium text-ink-muted">
                        {isExpanded ? "Hide" : "Show all"}
                      </span>
                      <ChevronDown
                        aria-hidden
                        className={cn(
                          "size-3.5 text-ink-muted transition-transform duration-200",
                          isExpanded ? "rotate-180" : "rotate-0",
                        )}
                      />
                    </div>
                  </div>
                </div>
              </button>
              {isExpanded ? (
                <ul className="ml-5 flex flex-col gap-1 border-l border-ink-subtle/60 pl-3">
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
  const useActorAvatar = Boolean(decoded.actor && decoded.actorSeed);
  const inner = (
    <div
      className={cn(
        "relative flex items-start gap-3 rounded-2xl transition-colors",
        compact ? "px-2.5 py-2" : "px-3 py-3",
        isUnread && !compact
          ? "bg-paper-card ring-1 ring-ink-subtle/60"
          : compact
            ? "bg-transparent hover:bg-paper-card/40"
            : "bg-transparent hover:bg-paper-card/50",
      )}
    >
      {isUnread && !compact ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-3 left-1 size-2 rounded-full bg-coral"
        />
      ) : null}

      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full",
          compact ? "size-7" : "size-10",
          useActorAvatar
            ? actorColor(decoded.actorSeed!)
            : `${typeIcon.bg} ${typeIcon.fg}`,
        )}
        aria-hidden
      >
        {useActorAvatar ? (
          <span
            className={cn(
              "font-semibold uppercase",
              compact ? "text-[11px]" : "text-[15px]",
            )}
          >
            {initial(decoded.actor)}
          </span>
        ) : (
          <typeIcon.Icon
            className={cn(compact ? "size-3.5" : "size-[18px]")}
          />
        )}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-start gap-2">
          <p
            className={cn(
              "min-w-0 flex-1 font-semibold leading-snug text-ink",
              compact ? "text-[13px]" : "text-[15px]",
            )}
          >
            {decoded.primary}
          </p>
          <span
            className={cn(
              "shrink-0 font-medium tabular-nums text-ink-muted",
              compact ? "text-[11px]" : "text-[11px]",
            )}
            aria-label={row.createdAt.toLocaleString()}
            suppressHydrationWarning
          >
            {compactRelative(row.createdAt)}
          </span>
        </div>
        {decoded.secondary ? (
          <p
            className={cn(
              "leading-snug text-ink-muted",
              compact ? "text-[12px]" : "text-[13px]",
              compact ? "truncate" : "",
            )}
          >
            {decoded.secondary}
          </p>
        ) : null}
        {!compact && (decoded.meta || (decoded.circleSlug && decoded.circleName)) ? (
          <div className="mt-1 flex items-center gap-2">
            <CircleChip slug={decoded.circleSlug} name={decoded.circleName} />
            {decoded.meta ? (
              <span className="inline-flex items-center rounded-full bg-in/12 px-2 py-0.5 text-[11px] font-semibold text-in">
                {decoded.meta}
              </span>
            ) : null}
          </div>
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
          className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
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
        className="block w-full rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
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
    <span className="flex shrink-0 -space-x-2.5">
      {decoded.map((d, idx) => {
        const seed = d.actorSeed ?? d.actor ?? `idx-${idx}`;
        return (
          <span
            key={seed}
            className={cn(
              "flex size-10 items-center justify-center rounded-full text-[15px] font-semibold uppercase ring-2 ring-paper",
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
