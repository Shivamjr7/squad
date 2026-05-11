// Supabase Edge Function (Deno). Fans a notification row out to every Web
// Push subscription owned by the row's recipient. Called from two places:
//   1. The Next.js app via lib/notifications.ts after inserting in-app rows.
//   2. The remind-plans cron function after inserting plan_reminder rows.
//
// Both pass `{ notificationIds: string[] }` as the body and a Bearer token
// matching CRON_SECRET. We re-read the rows from Postgres so the caller
// can't spoof recipients — the row's user_id is the source of truth.
//
// Auth: requires Authorization: Bearer <CRON_SECRET>. CRON_SECRET is shared
// between the cron job and the Next.js process; rotating it is a single
// `supabase secrets set` away.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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

type NotificationRow = {
  id: string;
  user_id: string;
  type: "vote_in" | "plan_created" | "plan_reminder";
  payload: Record<string, unknown> | null;
};

type Payload = { title: string; body: string; url: string; tag?: string };

function payloadString(p: Record<string, unknown> | null, key: string): string | null {
  if (!p) return null;
  const v = p[key];
  return typeof v === "string" ? v : null;
}

function planIdFromPayload(
  p: Record<string, unknown> | null,
): string | null {
  return payloadString(p, "planId");
}

function renderPayload(row: NotificationRow): Payload {
  const p = row.payload ?? {};
  const slug = payloadString(p, "circleSlug");
  const planId = payloadString(p, "planId");
  const planTitle = payloadString(p, "planTitle") ?? "this plan";
  const url = slug && planId
    ? `${APP_URL}/c/${slug}/p/${planId}`
    : APP_URL || "/";

  switch (row.type) {
    case "vote_in": {
      const name = payloadString(p, "voterName") ?? "Someone";
      return {
        title: "Squad",
        body: `${name} is in for ${planTitle}.`,
        url,
        tag: planId ? `plan:${planId}` : undefined,
      };
    }
    case "plan_created": {
      const name = payloadString(p, "creatorName") ?? "Someone";
      return {
        title: "New plan",
        body: `${name} started ${planTitle}.`,
        url,
        tag: planId ? `plan:${planId}` : undefined,
      };
    }
    case "plan_reminder": {
      const iso = payloadString(p, "startsAtIso");
      let when = "soon";
      if (iso) {
        try {
          when = new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }).format(new Date(iso));
        } catch {
          when = "soon";
        }
      }
      return {
        title: planTitle,
        body: `Starts at ${when}.`,
        url,
        tag: planId ? `reminder:${planId}` : undefined,
      };
    }
  }
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

  const payload = renderPayload(row);
  const body = JSON.stringify(payload);

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
            // Collapsing key — replaces older pushes for the same plan so the
            // shade doesn't pile up multiple "Karan is in" rows. The header
            // caps at 32 url-safe chars; UUIDs are 36 with hyphens, so strip.
            ...(planIdFromPayload(row.payload)
              ? { topic: planIdFromPayload(row.payload)!.replace(/-/g, "") }
              : {}),
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
