// Supabase Edge Function (Deno). Fans a notification row out to every Web
// Push subscription owned by the row's recipient. Called from two places:
//   1. The Next.js app via lib/notifications.ts after inserting in-app rows.
//   2. The remind-plans cron function after inserting plan_reminder rows.
//
// Both pass `{ notificationIds: string[] }` as the body and a Bearer token
// matching CRON_SECRET. We re-read the rows from Postgres so the caller
// can't spoof recipients — the row's user_id is the source of truth.
//
// M31.5 — payload composition lives in `src/lib/notifications-payload.ts`.
// That module is pure (no DB, no env, no Node/Deno-specific imports), so
// both the Next.js dispatcher and this Deno function call the same
// `composePushPayload` and emit identical `showNotification` shapes. The
// 3 KB JSON budget (NOTIFICATIONS_PLAN §5) is enforced here at send time —
// over-budget payloads fall back to `stripPushPayloadToMinimum` (title +
// body + url + tag) so the push still lands.
//
// Auth: requires Authorization: Bearer <CRON_SECRET>. CRON_SECRET is shared
// between the cron job and the Next.js process; rotating it is a single
// `supabase secrets set` away.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import {
  type ComposedPushPayload,
  type ComposeInput,
  composePushPayload,
  PUSH_PAYLOAD_BUDGET_BYTES,
  stripPushPayloadToMinimum,
} from "../../../src/lib/notifications-payload.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ??
  Deno.env.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:noreply@squad.app";
const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// ─── payload rendering ──────────────────────────────────────────────────

// Mirrors the active enum values in the `notification_type` Postgres enum
// (post-M31.1 migration). `plan_reminder` is legacy but still composable.
type NotificationKind = ComposeInput["type"];
const KNOWN_KINDS: ReadonlySet<NotificationKind> = new Set<NotificationKind>([
  "vote_in",
  "plan_created",
  "plan_locked",
  "plan_leave_soon",
  "plan_cancelled",
  "plan_reminder",
]);

type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown> | null;
};

function planIdFromPayload(
  p: Record<string, unknown> | null,
): string | null {
  if (!p) return null;
  const v = p.planId;
  return typeof v === "string" ? v : null;
}

// Compose a push body from a row. Returns null when the row is
// uncomposable (unknown type, missing required surface fields, or composer
// throws). The caller skips null results — one bad row never kills a batch.
function buildPushBody(row: NotificationRow): {
  body: string;
  composed: ComposedPushPayload;
} | null {
  if (!KNOWN_KINDS.has(row.type as NotificationKind)) {
    console.warn("[send-push] unknown notification type, skipping", {
      id: row.id,
      type: row.type,
    });
    return null;
  }
  const p = row.payload;
  // Minimum surface: composer reads circleSlug + planId from every kind to
  // build the click URL. Missing either makes the push useless.
  if (
    !p ||
    typeof (p as Record<string, unknown>).planId !== "string" ||
    typeof (p as Record<string, unknown>).circleSlug !== "string"
  ) {
    console.warn("[send-push] payload missing planId/circleSlug, skipping", {
      id: row.id,
      type: row.type,
    });
    return null;
  }

  let composed: ComposedPushPayload;
  try {
    // Cast is safe given the KNOWN_KINDS + planId/circleSlug guards above;
    // remaining per-kind fields render as their fallbacks if absent.
    composed = composePushPayload(
      { type: row.type, payload: p } as ComposeInput,
      { appUrl: APP_URL },
    );
  } catch (err) {
    console.error("[send-push] compose failed, skipping", {
      id: row.id,
      type: row.type,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  let body = JSON.stringify(composed);
  // 3 KB JSON budget — the Web Push hard cap is ~4 KB encrypted, so we
  // leave room for AES-128-GCM overhead. Strip to title+body+url+tag if
  // the rich shape (image/actions/vibrate) blows past it.
  if (byteLengthUtf8(body) > PUSH_PAYLOAD_BUDGET_BYTES) {
    console.warn("[send-push] payload over 3KB budget, stripping", {
      id: row.id,
      type: row.type,
      bytes: byteLengthUtf8(body),
    });
    composed = stripPushPayloadToMinimum(composed);
    body = JSON.stringify(composed);
    if (byteLengthUtf8(body) > PUSH_PAYLOAD_BUDGET_BYTES) {
      console.error("[send-push] stripped payload still over budget, skipping", {
        id: row.id,
        type: row.type,
        bytes: byteLengthUtf8(body),
      });
      return null;
    }
  }

  return { body, composed };
}

// Deno's TextEncoder is built-in; this is the cheapest way to count UTF-8
// bytes (string.length counts UTF-16 code units, not bytes).
const ENCODER = new TextEncoder();
function byteLengthUtf8(s: string): number {
  return ENCODER.encode(s).byteLength;
}

// ─── push fan-out ───────────────────────────────────────────────────────

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

async function fanOutForNotification(row: NotificationRow): Promise<number> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn("[send-push] VAPID keys not configured; skipping", {
      id: row.id,
    });
    return 0;
  }

  const built = buildPushBody(row);
  if (!built) return 0;
  const { body } = built;

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", row.user_id)
    .returns<SubscriptionRow[]>();
  if (error) {
    console.error("[send-push] subscription lookup failed", {
      id: row.id,
      error: error.message,
    });
    return 0;
  }
  if (!subs || subs.length === 0) return 0;

  const planId = planIdFromPayload(row.payload);

  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          {
            TTL: 60 * 60,
            // High urgency tells FCM to wake the device from doze instead of
            // batching the message until the next idle window. Without this
            // header the default is "normal", which is why pushes only
            // surface when the user opens the app on Android.
            urgency: "high",
            // Push-service-side collapsing key — replaces older queued
            // messages for the same plan when a device is offline. OS-shade
            // collapse is handled separately by the `tag` field in the
            // payload (see notifications-payload.ts). The header caps at
            // 32 url-safe chars; UUIDs are 36 with hyphens, so strip.
            ...(planId ? { topic: planId.replace(/-/g, "") } : {}),
          },
        );
        sent += 1;
        // Best-effort last_used_at refresh; not awaited critically.
        void supabase
          .from("push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", sub.id);
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          // Subscription is dead — clean it up. Other rows for the same user
          // (e.g. a different device) are preserved.
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint);
          return;
        }
        console.error("[send-push] send failed", {
          endpoint: sub.endpoint,
          status,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
  return sent;
}

// ─── handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (!CRON_SECRET) {
    return new Response(
      JSON.stringify({ error: "CRON_SECRET not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { notificationIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const ids = Array.isArray(body.notificationIds)
    ? body.notificationIds.filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: rows, error } = await supabase
    .from("notifications")
    .select("id, user_id, type, payload")
    .in("id", ids)
    .returns<NotificationRow[]>();
  if (error) {
    console.error("[send-push] notification fetch failed", error);
    return new Response(
      JSON.stringify({ error: "fetch failed", detail: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!rows || rows.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  let sent = 0;
  for (const row of rows) {
    try {
      sent += await fanOutForNotification(row);
    } catch (err) {
      console.error("[send-push] per-row failed", {
        id: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  console.log("[send-push]", { requested: ids.length, sent });
  return new Response(JSON.stringify({ sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
