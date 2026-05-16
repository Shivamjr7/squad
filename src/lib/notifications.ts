// Internal notification dispatcher + push-payload composer. Called from
// server actions on the trigger side (vote cast, plan create, lock, cancel)
// and from anywhere else that wants to drop a row into a user's feed.
// Three responsibilities:
//
//   1. Insert one row per recipient into the `notifications` table — that's
//      the in-app feed. Read by listNotifications + getUnreadCount.
//   2. Fire-and-forget hand-off to the Supabase Edge Function `send-push`,
//      which fans the same payload out to every push_subscriptions row owned
//      by each recipient. The HTTP call is awaited as a Promise but its
//      errors are swallowed — push delivery must not fail the trigger.
//   3. Expose `composePushPayload(...)` — a pure helper that turns a row
//      (or in-flight dispatch) into the `showNotification` shape. Same
//      input, same output across both callers (Next.js dispatcher → HTTP,
//      edge function → web-push). M31 §9.
//
// We don't use Supabase Database Webhooks for the hand-off because that
// requires manual project-config glue. A direct fetch from the Next.js
// server keeps the wiring inside this repo. Cron-driven notifications
// (plan_leave_soon) skip this module entirely — the edge function inserts
// its own rows and fans out without an HTTP round-trip.

import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships, notifications, planRecipients } from "@/db/schema";

// ─── Payload shapes ─────────────────────────────────────────────────────
// One per notification type. The dispatcher accepts a discriminated union
// so the call site can't assemble a `vote_in` payload with reminder fields.
//
// M31 — five active kinds. The legacy `plan_reminder` type is preserved in
// the schema enum for in-flight rows but no new code writes it; the
// composer renders it for back-compat with rows already in the table.

export type VoteInPayload = {
  planId: string;
  planTitle: string;
  circleSlug: string;
  circleName: string;
  voterName: string;
  voterId: string;
  // ISO of plan starts_at. Lets the push body render "Karan: in for 8:30"
  // without re-querying inside the composer. Plans in `open` time mode
  // before a lock have starts_at = NULL-ish placeholder — call site sets
  // this to null and the composer drops the time suffix.
  startsAtIso: string | null;
};

export type PlanCreatedPayload = {
  planId: string;
  planTitle: string;
  circleSlug: string;
  circleName: string;
  creatorName: string;
  creatorId: string;
};

export type PlanLockedPayload = {
  planId: string;
  planTitle: string;
  circleSlug: string;
  circleName: string;
  startsAtIso: string;
  location: string | null;
  // Vote tally at the moment of lock — the push body reads "5 of 6 said yes"
  // from these. totalRecipients = recipient set size (or circle size if no
  // recipients). The dispatcher caller is the only place that knows this
  // without an extra query.
  inCount: number;
  totalRecipients: number;
  // Mirrors auto-lock.ts's trigger enum so the body copy can lean on the
  // reason ("threshold hit" / "deadline" / "everyone voted").
  trigger: "threshold" | "forced" | "all_voted";
  // Optional pre-computed map deep-link for the action button. Computed
  // server-side because client UA isn't known at push time; Apple Maps
  // universal links open in Maps.app on iOS, Google Maps elsewhere.
  directionsUrl?: string | null;
};

export type PlanLeaveSoonPayload = {
  planId: string;
  planTitle: string;
  circleSlug: string;
  circleName: string;
  startsAtIso: string;
  location: string | null;
  // Minutes until starts_at at composition time. The 45-min cron usually
  // lands this in [40, 50]; we round to 5 for body copy ("Leave in ~45m").
  minutesUntilStart: number;
  directionsUrl?: string | null;
};

export type PlanCancelledPayload = {
  planId: string;
  planTitle: string;
  circleSlug: string;
  circleName: string;
  cancellerName: string | null;
};

// Legacy — kept so the composer can still render plan_reminder rows that
// landed in the table before M31. No trigger site writes this kind in M31+.
export type PlanReminderPayload = {
  planId: string;
  planTitle: string;
  circleSlug: string;
  circleName: string;
  startsAtIso: string;
  location: string | null;
};

// Dispatch input — five active kinds. The dispatcher will not insert
// `plan_reminder` because callers shouldn't be creating new reminder rows.
export type NotificationPayload =
  | { type: "vote_in"; payload: VoteInPayload }
  | { type: "plan_created"; payload: PlanCreatedPayload }
  | { type: "plan_locked"; payload: PlanLockedPayload }
  | { type: "plan_leave_soon"; payload: PlanLeaveSoonPayload }
  | { type: "plan_cancelled"; payload: PlanCancelledPayload };

export type DispatchInput = NotificationPayload & {
  userIds: string[];
};

// Composer input — includes plan_reminder for legacy-row back-compat. Both
// the Next.js dispatcher and (in M31.5) the send-push edge function call
// composePushPayload with `{ type, payload }` shaped like this.
export type ComposeInput =
  | NotificationPayload
  | { type: "plan_reminder"; payload: PlanReminderPayload };

export async function dispatchNotifications(
  input: DispatchInput,
): Promise<void> {
  if (input.userIds.length === 0) return;

  // De-dupe defensively in case a caller passes the creator alongside the
  // recipient set.
  const uniqueIds = Array.from(new Set(input.userIds));

  const inserted = await db
    .insert(notifications)
    .values(
      uniqueIds.map((userId) => ({
        userId,
        type: input.type,
        payload: input.payload,
      })),
    )
    .returning({ id: notifications.id });

  if (inserted.length === 0) return;

  // Push fan-out runs on Supabase Edge; the Next.js process only signals it.
  // Fire-and-forget — errors get logged, never thrown, so a downed edge
  // function doesn't take down the trigger.
  void invokeSendPush(inserted.map((r) => r.id));
}

async function invokeSendPush(notificationIds: string[]): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.CRON_SECRET;
  if (!url || !secret) {
    // Local dev or unconfigured deploy — skip silently. The in-app rows are
    // already written so users still see the notification on next page load.
    return;
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/functions/v1/send-push`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ notificationIds }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[notifications] send-push non-2xx", {
        status: res.status,
        body,
      });
    }
  } catch (err) {
    console.warn("[notifications] send-push fetch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Push payload composer ──────────────────────────────────────────────
// Pure function — no DB, no env. Same input, same output. Shared between
// the Next.js dispatch path (for prepping the row payload preview) and the
// send-push edge function (for the actual webpush.sendNotification body).
//
// `tag` semantics map to the Web Push spec: notifications with the same tag
// collapse on the OS shade. NOTIFICATIONS_PLAN §3 fixes the per-kind tags so
// a vote storm collapses to one bubble and a lock supersedes its preceding
// "voting open" bubbles.
//
// iOS Safari ≥16.4 silently ignores `image`, `actions`, `badge`, `vibrate`
// — the composer always emits the rich payload and the OS strips what it
// doesn't support. We do not UA-sniff.

export type PushAction = { action: string; title: string };

export type ComposedPushPayload = {
  title: string;
  body: string;
  url: string;
  // OS-level collapse key. NOTIFICATIONS_PLAN §3:
  //   vote_in         → plan:{id}:votes      (collapses vote storms)
  //   plan_created    → plan:{id}:created
  //   plan_locked     → plan:{id}:state      (supersedes voting-open bubbles)
  //   plan_cancelled  → plan:{id}:state      (supersedes locked)
  //   plan_leave_soon → plan:{id}:leave
  //   plan_reminder   → plan:{id}:reminder   (legacy)
  tag: string;
  // false for vote_in so a burst of "in" votes collapses silently into one
  // bubble; true everywhere else so the user actually hears the state change.
  renotify: boolean;
  icon: string;
  // Monochrome 96×96 used by Android in the status-bar strip. iOS ignores.
  badge: string;
  // Android-only venue thumbnail / hero. iOS ignores. Set per-kind below;
  // omitted when we don't have anything meaningful to show.
  image?: string;
  // [80, 40, 80] on locked, undefined elsewhere — the lock is the only
  // moment that earns a haptic, and only Android honors it.
  vibrate?: number[];
  // Android-only action buttons. iOS ignores. Keys map to
  // public/sw.js's notificationclick action router.
  actions?: PushAction[];
  // Click payload — the service worker uses this to route deep-links.
  data: {
    url: string;
    type: ComposeInput["type"];
    planId: string | null;
    directionsUrl?: string | null;
  };
};

const DEFAULT_ICON = "/icon-192.png";
const DEFAULT_BADGE = "/icon-badge.png";

// Format an ISO timestamp into the "8:30" body fragment. We intentionally
// don't include AM/PM — the push body is short and the squad context is
// already evening-skewed. Falls back to "soon" on parse error.
function formatBodyTime(iso: string | null | undefined): string {
  if (!iso) return "soon";
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      // "8:30 PM" → drop seconds, drop ZZ — Intl already does, but be
      // explicit so the body stays short.
    }).format(new Date(iso));
  } catch {
    return "soon";
  }
}

// Universal maps deep-link builder. Apple Maps's universal `maps.apple.com`
// URL opens in Maps.app on iOS but renders a Google Maps redirect on other
// platforms, which is wrong. We default to Google Maps's universal search
// URL — opens in Maps.app on iOS too via Apple's universal-link handler if
// the user has it set up, and falls back to the Google web view otherwise.
// Trigger sites can override via `directionsUrl` if they have something
// richer (e.g. an explicit place_id from suggestions).
function defaultDirectionsUrl(location: string | null): string | null {
  if (!location) return null;
  const q = encodeURIComponent(location);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

// The base URL that the service worker opens on click. The dispatcher
// callers pass `circleSlug` + `planId`; the composer builds the deep-link
// in one place so the in-app feed (lib/actions/notifications) and the push
// (this composer) can never drift. `appUrl` is "" in dev / Next.js context
// where same-origin works fine; the edge function passes its absolute origin.
function planUrl(appUrl: string, slug: string, planId: string): string {
  const base = appUrl.replace(/\/$/, "");
  return `${base}/c/${slug}/p/${planId}`;
}

export type ComposeOptions = {
  // Absolute origin to prefix paths with. Required by the edge function for
  // the click URL (web-push payloads must be self-contained). The Next.js
  // dispatcher passes "" so the row payload stays origin-relative — it isn't
  // delivered over the wire from this side; only the in-app feed reads it.
  appUrl?: string;
};

export function composePushPayload(
  input: ComposeInput,
  opts: ComposeOptions = {},
): ComposedPushPayload {
  const appUrl = opts.appUrl ?? "";
  const p = input.payload;
  const url = planUrl(appUrl, p.circleSlug, p.planId);
  const planId = p.planId;
  const baseData: ComposedPushPayload["data"] = {
    url,
    type: input.type,
    planId,
  };

  switch (input.type) {
    case "vote_in": {
      // "Karan: in for 8:30" — quote-voice copy per NOTIFICATIONS_PLAN §3.
      const when = formatBodyTime(input.payload.startsAtIso);
      return {
        title: input.payload.circleName,
        body: input.payload.startsAtIso
          ? `${input.payload.voterName}: in for ${when}`
          : `${input.payload.voterName}: in for ${input.payload.planTitle}`,
        url,
        tag: `plan:${planId}:votes`,
        renotify: false,
        icon: DEFAULT_ICON,
        badge: DEFAULT_BADGE,
        data: baseData,
      };
    }

    case "plan_created": {
      // "Mira started a plan · Movie night"
      return {
        title: input.payload.circleName,
        body: `${input.payload.creatorName} started a plan · ${input.payload.planTitle}`,
        url,
        tag: `plan:${planId}:created`,
        renotify: true,
        icon: DEFAULT_ICON,
        badge: DEFAULT_BADGE,
        data: baseData,
      };
    }

    case "plan_locked": {
      // "It's happening — 8:30 at Roxie · 5 of 6 said yes"
      const when = formatBodyTime(input.payload.startsAtIso);
      const where = input.payload.location?.trim() || input.payload.planTitle;
      const tally = `${input.payload.inCount} of ${input.payload.totalRecipients} said yes`;
      const directions =
        input.payload.directionsUrl ?? defaultDirectionsUrl(input.payload.location);
      return {
        title: "It's happening",
        body: `${when} at ${where} · ${tally}`,
        url,
        tag: `plan:${planId}:state`,
        renotify: true,
        icon: DEFAULT_ICON,
        badge: DEFAULT_BADGE,
        vibrate: [80, 40, 80],
        actions: directions
          ? [
              { action: "directions", title: "Directions" },
              { action: "open_squad", title: "Squad chat" },
            ]
          : [{ action: "open_squad", title: "Squad chat" }],
        data: { ...baseData, directionsUrl: directions },
      };
    }

    case "plan_leave_soon": {
      // "Leave in ~45m · Roxie" — the "12 min walk" half is client-only
      // (geolocation), the push body just nudges with the venue.
      const minutes = Math.max(5, Math.round(input.payload.minutesUntilStart / 5) * 5);
      const where = input.payload.location?.trim();
      const directions =
        input.payload.directionsUrl ?? defaultDirectionsUrl(input.payload.location);
      return {
        title: input.payload.planTitle,
        body: where ? `Leave in ~${minutes}m · ${where}` : `Leave in ~${minutes}m`,
        url,
        tag: `plan:${planId}:leave`,
        renotify: true,
        icon: DEFAULT_ICON,
        badge: DEFAULT_BADGE,
        actions: directions
          ? [{ action: "directions", title: "Directions" }]
          : undefined,
        data: { ...baseData, directionsUrl: directions },
      };
    }

    case "plan_cancelled": {
      // "Plan off — Movie night cancelled"
      return {
        title: "Plan off",
        body: `${input.payload.planTitle} cancelled`,
        url,
        // Same tag as plan_locked so a cancellation supersedes any prior
        // "It's happening" bubble on the shade — the user sees the latest
        // state, not a contradictory pair.
        tag: `plan:${planId}:state`,
        renotify: true,
        icon: DEFAULT_ICON,
        badge: DEFAULT_BADGE,
        data: baseData,
      };
    }

    case "plan_reminder": {
      // Legacy. Kept so plan_reminder rows already in the DB still render
      // a sensible push body if the edge function ever replays them.
      const when = formatBodyTime(input.payload.startsAtIso);
      return {
        title: input.payload.planTitle,
        body: `Starts at ${when}.`,
        url,
        tag: `plan:${planId}:reminder`,
        renotify: true,
        icon: DEFAULT_ICON,
        badge: DEFAULT_BADGE,
        data: baseData,
      };
    }
  }
}

// 3 KB Web Push budget guard (NOTIFICATIONS_PLAN §5). Returns a stripped
// version of the composed payload — title + body + url + tag only — for
// the rare case the rich shape JSON-encodes past 3 KB. The edge function
// (M31.5) calls this if its initial JSON.stringify exceeds the cap.
export function stripPushPayloadToMinimum(
  composed: ComposedPushPayload,
): ComposedPushPayload {
  return {
    title: composed.title,
    body: composed.body,
    url: composed.url,
    tag: composed.tag,
    renotify: composed.renotify,
    icon: composed.icon,
    badge: composed.badge,
    data: { url: composed.data.url, type: composed.data.type, planId: composed.data.planId },
  };
}

// Resolves "everyone on this plan except the actor". Plan recipients if the
// row set is non-empty, else full circle membership. Used by the in-app
// trigger sites so they share one definition of audience.
export async function resolvePlanAudience(
  planId: string,
  circleId: string,
  excludeUserId: string | null,
): Promise<string[]> {
  const recipientRows = await db
    .select({ userId: planRecipients.userId })
    .from(planRecipients)
    .where(eq(planRecipients.planId, planId));

  if (recipientRows.length > 0) {
    const ids = recipientRows.map((r) => r.userId);
    if (!excludeUserId) return ids;
    return ids.filter((id) => id !== excludeUserId);
  }

  const memberRows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      excludeUserId
        ? and(
            eq(memberships.circleId, circleId),
            ne(memberships.userId, excludeUserId),
          )
        : eq(memberships.circleId, circleId),
    );
  return memberRows.map((r) => r.userId);
}
