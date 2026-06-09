// Pure push-payload composer. NOTIFICATIONS_PLAN §9 mandates a single
// composer shared between the Next.js dispatcher and the Supabase Edge
// `send-push` function. This file is the source of truth: no DB, no env,
// no Node- or Deno-specific imports — both runtimes can load it safely.
//
// The Deno edge function imports this file via a relative path
// (`../../../src/lib/notifications-payload.ts`); Next.js code imports it
// via the `@/lib/notifications-payload` alias or transitively through
// `@/lib/notifications` re-exports. Don't add stateful imports here.

// ─── Payload shapes ─────────────────────────────────────────────────────
// One per notification type. The dispatcher accepts a discriminated union
// so the call site can't assemble a `vote_in` payload with reminder fields.
//
// M31 — five active kinds. M32 reuses `plan_reminder` for the pre-deadline
// "you have not voted yet" nudge so the cron can ship the reminder without
// adding another enum value.

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
  // IANA zone of the plan (plans.time_zone). Required so the push body
  // and in-app feed both render the hour the creator picked rather than
  // the Vercel runtime's UTC default. Nullable when startsAtIso is null
  // (open-mode plans before lock), to keep the two fields paired.
  timeZone: string | null;
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
  // IANA zone of the plan (plans.time_zone). See VoteInPayload.
  timeZone: string;
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
  // IANA zone of the plan (plans.time_zone). See VoteInPayload.
  timeZone: string;
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

// M32 — cross-circle conflict + resolution payloads. Per CONVERGENCE_PLAN.md
// §5, the OS tag is `conflict:{userId}:{planA}:{planB}` with canonical-sorted
// plan ids so the two-way pair collapses to one bubble and the resolution
// push overrides the conflict push on the shade. The userId rides on the
// payload because the composer is per-row (the dispatcher writes one row per
// recipient) and that's where the tag is built.
//
// `planId` is the *anchor* plan — the one whose change just triggered the
// notification (the newly-created plan, the just-locked plan, the just-voted
// plan). Click → that plan's detail page. `otherPlanId` is the existing
// commitment that now collides.
export type PlanConflictPayload = {
  recipientUserId: string;
  planId: string;
  planTitle: string;
  circleSlug: string;
  circleName: string;
  otherPlanId: string;
  otherPlanTitle: string;
  otherCircleName: string;
};

export type PlanConflictResolvedPayload = {
  recipientUserId: string;
  planId: string;
  planTitle: string;
  circleSlug: string;
  circleName: string;
  otherPlanId: string;
  otherPlanTitle: string;
  otherCircleName: string;
};

// Legacy — kept so the composer can still render plan_reminder rows that
// landed in the table before M31. No trigger site writes this kind in M31+.
export type PlanReminderPayload = {
  planId: string;
  planTitle: string;
  circleSlug: string;
  circleName: string;
  startsAtIso: string;
  // IANA zone of the plan (plans.time_zone). See VoteInPayload. Legacy
  // rows in the table predate this field — composer falls back to UTC.
  timeZone?: string;
  location: string | null;
  decideByIso?: string | null;
};

// Dispatch input — seven active kinds (M31 five + M32 two). The cron inserts
// plan_reminder rows directly because it runs in Deno.
export type NotificationPayload =
  | { type: "vote_in"; payload: VoteInPayload }
  | { type: "plan_created"; payload: PlanCreatedPayload }
  | { type: "plan_locked"; payload: PlanLockedPayload }
  | { type: "plan_leave_soon"; payload: PlanLeaveSoonPayload }
  | { type: "plan_cancelled"; payload: PlanCancelledPayload }
  | { type: "plan_conflict"; payload: PlanConflictPayload }
  | { type: "plan_conflict_resolved"; payload: PlanConflictResolvedPayload };

// Composer input — includes plan_reminder for legacy-row back-compat. Both
// the Next.js dispatcher and the send-push edge function call
// composePushPayload with `{ type, payload }` shaped like this.
export type ComposeInput =
  | NotificationPayload
  | { type: "plan_reminder"; payload: PlanReminderPayload };

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
  // Same body shape as `body` but with PUSH_TIME_PLACEHOLDER in place of the
  // wall-clock fragment. v5+ SWs prefer this and substitute the placeholder
  // with a device-formatted time; v4 SWs ignore it and render `body` as-is.
  // Omitted for kinds with no time-bearing fragment (plan_created,
  // plan_cancelled, plan_leave_soon — minutes are relative).
  bodyTemplate?: string;
  // Click payload — the service worker uses this to route deep-links.
  data: {
    url: string;
    type: ComposeInput["type"];
    planId: string | null;
    directionsUrl?: string | null;
    // Set alongside bodyTemplate. The SW formats this ISO using the plan's
    // IANA zone when it's a real value, else the device's local zone, and
    // substitutes PUSH_TIME_PLACEHOLDER before calling showNotification.
    startsAtIso?: string | null;
    timeZone?: string | null;
  };
};

// Built via concat instead of as string literals so the Supabase CLI's
// static asset scanner doesn't try to upload `/icon-*.png` files alongside
// the edge function bundle (they're public/ assets, not function assets).
function publicAssetPath(name: string): string {
  return "/" + name;
}
export const DEFAULT_ICON = publicAssetPath("icon-192.png");
export const DEFAULT_BADGE = publicAssetPath("icon-badge.png");

// Sentinel substituted by public/sw.js at push-receive time, where the
// browser's runtime zone is the recipient's actual zone. The composer runs
// in the Supabase Edge runtime (Deno, always UTC) so any wall-clock string
// it tries to bake into the body would render in UTC when the plan's zone
// is missing/"UTC" in the payload. Emitting a placeholder defers formatting
// to the device, mirroring how src/components/notifications/notifications-feed.tsx
// renders the in-app feed.
//
// If the SW is older than this composer (user hasn't picked up the new
// /sw.js yet), the placeholder leaks into the visible body for one push.
// Acceptable transition cost — SWs update on the next navigation, and the
// alternative ("8:30 PM" rendered in UTC) is silently wrong forever.
export const PUSH_TIME_PLACEHOLDER = "{TIME}";

// Fallback wall-clock formatter for the `body` field — runs in the composer's
// runtime (Deno on Supabase Edge → UTC). Only old (v4) SWs that don't know
// about PUSH_TIME_PLACEHOLDER actually read this; v5+ SWs use bodyTemplate
// and re-format on the device. We still render a best-effort string so old
// SWs show *something* readable instead of a placeholder.
function formatBodyTime(
  iso: string | null | undefined,
  timeZone: string | null | undefined,
): string {
  if (!iso) return "soon";
  const zone =
    typeof timeZone === "string" && timeZone.length > 0 && timeZone !== "UTC"
      ? timeZone
      : undefined;
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: zone,
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
      // body is the v4-SW fallback (server-formatted in UTC if zone missing);
      // bodyTemplate is what v5+ SWs substitute on-device.
      const hasTime = input.payload.startsAtIso !== null;
      if (!hasTime) {
        return {
          title: input.payload.circleName,
          body: `${input.payload.voterName}: in for ${input.payload.planTitle}`,
          url,
          tag: `plan:${planId}:votes`,
          renotify: false,
          icon: DEFAULT_ICON,
          badge: DEFAULT_BADGE,
          data: baseData,
        };
      }
      const when = formatBodyTime(
        input.payload.startsAtIso,
        input.payload.timeZone,
      );
      return {
        title: input.payload.circleName,
        body: `${input.payload.voterName}: in for ${when}`,
        bodyTemplate: `${input.payload.voterName}: in for ${PUSH_TIME_PLACEHOLDER}`,
        url,
        tag: `plan:${planId}:votes`,
        renotify: false,
        icon: DEFAULT_ICON,
        badge: DEFAULT_BADGE,
        data: {
          ...baseData,
          startsAtIso: input.payload.startsAtIso,
          timeZone: input.payload.timeZone,
        },
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
      // body = v4-SW fallback (server-formatted); bodyTemplate = v5+ template.
      const where = input.payload.location?.trim() || input.payload.planTitle;
      const tally = `${input.payload.inCount} of ${input.payload.totalRecipients} said yes`;
      const when = formatBodyTime(
        input.payload.startsAtIso,
        input.payload.timeZone,
      );
      const directions =
        input.payload.directionsUrl ?? defaultDirectionsUrl(input.payload.location);
      return {
        title: "It's happening",
        body: `${when} at ${where} · ${tally}`,
        bodyTemplate: `${PUSH_TIME_PLACEHOLDER} at ${where} · ${tally}`,
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
        data: {
          ...baseData,
          directionsUrl: directions,
          startsAtIso: input.payload.startsAtIso,
          timeZone: input.payload.timeZone,
        },
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
      // Pre-deadline RSVP nudge. Legacy rows that lack decideByIso still
      // render a sensible starts-at reminder.
      const when = formatBodyTime(
        input.payload.startsAtIso,
        input.payload.timeZone,
      );
      const hasDecisionDeadline =
        typeof input.payload.decideByIso === "string" &&
        input.payload.decideByIso.length > 0;
      return {
        title: input.payload.planTitle,
        body: hasDecisionDeadline
          ? "Vote before it locks."
          : `Starts at ${when}.`,
        bodyTemplate: hasDecisionDeadline
          ? "Vote before it locks."
          : `Starts at ${PUSH_TIME_PLACEHOLDER}.`,
        url,
        tag: `plan:${planId}:reminder`,
        renotify: true,
        icon: DEFAULT_ICON,
        badge: DEFAULT_BADGE,
        data: {
          ...baseData,
          startsAtIso: input.payload.startsAtIso,
          timeZone: input.payload.timeZone ?? null,
        },
      };
    }

    case "plan_conflict": {
      // Canonical-sorted pair tag — A↔B and B↔A collapse to the same shade
      // entry, and the matching plan_conflict_resolved push overrides it.
      const [a, b] = [input.payload.planId, input.payload.otherPlanId].sort();
      // Push click lands on the anchor plan with `?conflictWith=…` so the
      // page server-renders the compare sheet's data and the launcher pops
      // it open on first paint. Notification feed click reuses the same URL.
      const compareUrl = `${url}?conflictWith=${input.payload.otherPlanId}`;
      return {
        title: "Heads up",
        body: `${input.payload.planTitle} clashes with ${input.payload.otherPlanTitle} in ${input.payload.otherCircleName}`,
        url: compareUrl,
        tag: `conflict:${input.payload.recipientUserId}:${a}:${b}`,
        // false — §5 "same pair never re-fires". The ledger row enforces this
        // server-side; renotify=false is a belt-and-braces guard against the
        // OS re-buzzing if the row were ever re-dispatched.
        renotify: false,
        icon: DEFAULT_ICON,
        badge: DEFAULT_BADGE,
        data: { ...baseData, url: compareUrl },
      };
    }

    case "plan_conflict_resolved": {
      const [a, b] = [input.payload.planId, input.payload.otherPlanId].sort();
      return {
        title: "Sorted",
        body: `${input.payload.planTitle} and ${input.payload.otherPlanTitle} no longer clash`,
        url,
        tag: `conflict:${input.payload.recipientUserId}:${a}:${b}`,
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
// the rare case the rich shape JSON-encodes past 3 KB. The send-push edge
// function calls this when its initial JSON.stringify exceeds the cap.
export function stripPushPayloadToMinimum(
  composed: ComposedPushPayload,
): ComposedPushPayload {
  return {
    title: composed.title,
    body: composed.body,
    bodyTemplate: composed.bodyTemplate,
    url: composed.url,
    tag: composed.tag,
    renotify: composed.renotify,
    icon: composed.icon,
    badge: composed.badge,
    data: {
      url: composed.data.url,
      type: composed.data.type,
      planId: composed.data.planId,
      // Preserve so v5+ SWs can still substitute PUSH_TIME_PLACEHOLDER on
      // the stripped path.
      startsAtIso: composed.data.startsAtIso,
      timeZone: composed.data.timeZone,
    },
  };
}

// Web Push hard cap is ~4 KB encrypted; the composer enforces 3 KB on the
// JSON body to leave headroom for the AES-128-GCM overhead.
export const PUSH_PAYLOAD_BUDGET_BYTES = 3072;
