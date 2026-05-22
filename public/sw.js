// Squad service worker (M26, push handlers added M30).
// Goal: make the app installable as a real PWA, keep static assets fast,
// and surface Web Push notifications when the edge function fans them out.
// Non-goal: serving authenticated dynamic content while offline — that lives
// in the network. We only fall back to a tiny offline shell when nav fails.
//
// Bump CACHE_VERSION whenever the precache list changes to invalidate.
const CACHE_VERSION = "squad-shell-v5";
const PRECACHE = [
  "/offline",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];
// M31.4: monochrome badge for rich push. Soft-added so a missing binary
// (e.g. asset not yet deployed) doesn't block SW install.
const SOFT_PRECACHE = ["/icon-badge.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      await cache.addAll(PRECACHE);
      await Promise.all(
        SOFT_PRECACHE.map((path) => cache.add(path).catch(() => {})),
      );
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_VERSION)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Auth-cache purge on sign-out. The networkFirstNavigation handler below
// stashes HTML responses (including RSC payloads with user-specific
// state) so offline reloads of /c/<slug> work. On a shared device, after
// user A signs out, user B can hit "offline reload" and get A's cached
// shell. The Clerk sign-out button posts this message before redirecting
// — we drop every cached HTML entry in the shell cache. Static precache
// entries (offline page, icons, manifest) are re-added on next install.
self.addEventListener("message", (event) => {
  if (event.data?.type === "squad:purge-auth-cache") {
    event.waitUntil(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const keys = await cache.keys();
        await Promise.all(
          keys
            .filter((req) => {
              const url = new URL(req.url);
              // Keep the offline shell + manifest + icons.
              if (PRECACHE.includes(url.pathname)) return false;
              if (SOFT_PRECACHE.includes(url.pathname)) return false;
              return true;
            })
            .map((req) => cache.delete(req)),
        );
      }),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept auth or API traffic — Clerk sets short-lived cookies and
  // server actions must hit the network.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/sign-in") ||
    url.pathname.startsWith("/sign-up") ||
    url.pathname.startsWith("/onboarding") ||
    url.pathname.startsWith("/set-name") ||
    url.pathname.startsWith("/invite/")
  ) {
    return;
  }

  // Cache-first for hashed Next.js static assets — they're immutable.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Network-first for navigations; fall back to cache, then to /offline.
  if (req.mode === "navigate") {
    event.respondWith(networkFirstNavigation(req));
    return;
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

// ─── Web Push (M30, rich payload M31.4) ─────────────────────────────────
// The edge function `send-push` posts an AES-128-GCM-encrypted payload to
// the user's push endpoint. The browser decrypts and hands us the JSON via
// event.data. Shape (kept in sync with lib/notifications.ts):
//   { title, body, url, tag?, image?, renotify?, vibrate?, actions?,
//     type?, planId?, directionsUrl?, startsAtIso?, timeZone? }
// iOS Safari silently ignores image/badge/actions/vibrate — we always emit
// the rich shape and let the OS strip what it can't render.
//
// Time substitution: the composer in src/lib/notifications-payload.ts cannot
// know the recipient's local zone (it runs in the Supabase Edge Deno runtime,
// which is always UTC), so any time-bearing body ships with a "{TIME}"
// placeholder plus startsAtIso/timeZone in data. We format on the device
// using the plan's IANA zone when it's a real value, otherwise the browser's
// local zone — matching how src/components/notifications/notifications-feed.tsx
// renders the in-app feed.
const PUSH_TIME_PLACEHOLDER = "{TIME}";

function formatPushTime(iso, timeZone) {
  if (typeof iso !== "string" || iso.length === 0) return "soon";
  let zone;
  if (typeof timeZone === "string" && timeZone.length > 0 && timeZone !== "UTC") {
    zone = timeZone;
  } else {
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      zone = undefined;
    }
  }
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
self.addEventListener("push", (event) => {
  let data = { title: "Squad", body: "" };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // Non-JSON payload — show a generic notification rather than swallowing.
    data = { title: "Squad", body: event.data?.text?.() ?? "" };
  }

  const title = typeof data.title === "string" ? data.title : "Squad";
  const url = typeof data.url === "string" ? data.url : "/";
  // Time substitution. Prefer bodyTemplate (contains {TIME}) so we can
  // re-format using the device's zone; fall back to the server-rendered
  // body (may be in UTC if the plan's timeZone was missing/UTC) when the
  // template isn't shipped. Read startsAtIso/timeZone from data (current
  // shape) or top-level (any future shape) for forward-compat.
  let body = "";
  const startsAtIso =
    (data.data && typeof data.data.startsAtIso === "string"
      ? data.data.startsAtIso
      : null) ??
    (typeof data.startsAtIso === "string" ? data.startsAtIso : null);
  const timeZone =
    (data.data && typeof data.data.timeZone === "string"
      ? data.data.timeZone
      : null) ??
    (typeof data.timeZone === "string" ? data.timeZone : null);
  if (
    typeof data.bodyTemplate === "string" &&
    data.bodyTemplate.includes(PUSH_TIME_PLACEHOLDER) &&
    startsAtIso
  ) {
    body = data.bodyTemplate
      .split(PUSH_TIME_PLACEHOLDER)
      .join(formatPushTime(startsAtIso, timeZone));
  } else if (typeof data.body === "string") {
    body = data.body;
    // Defensive: if a stray {TIME} leaked into body (e.g. mid-rollout
    // payload from the old composer), substitute it instead of showing
    // the literal placeholder.
    if (body.includes(PUSH_TIME_PLACEHOLDER)) {
      body = body
        .split(PUSH_TIME_PLACEHOLDER)
        .join(formatPushTime(startsAtIso, timeZone));
    }
  }
  const tag = typeof data.tag === "string" ? data.tag : undefined;
  const image = typeof data.image === "string" ? data.image : undefined;
  // `renotify` only takes effect alongside a `tag` — gate it.
  const renotify = tag && data.renotify === true ? true : undefined;
  const vibrate = Array.isArray(data.vibrate)
    ? data.vibrate.filter((n) => typeof n === "number" && n >= 0 && n <= 5000)
    : undefined;
  // Chrome on Android caps action buttons at 2; slice defensively.
  const actions = Array.isArray(data.actions)
    ? data.actions
        .filter(
          (a) =>
            a &&
            typeof a === "object" &&
            typeof a.action === "string" &&
            typeof a.title === "string",
        )
        .slice(0, 2)
    : undefined;

  const options = {
    body,
    icon: "/icon-192.png",
    badge: "/icon-badge.png",
    tag,
    data: {
      url,
      type: typeof data.type === "string" ? data.type : undefined,
      planId: typeof data.planId === "string" ? data.planId : undefined,
      directionsUrl:
        typeof data.directionsUrl === "string"
          ? data.directionsUrl
          : undefined,
    },
  };
  if (image) options.image = image;
  if (renotify) options.renotify = true;
  if (vibrate && vibrate.length) options.vibrate = vibrate;
  if (actions && actions.length) options.actions = actions;

  event.waitUntil(self.registration.showNotification(title, options));
});

// notificationclick routes by `event.action`:
//   - "directions"  → open `data.directionsUrl` (cross-origin maps deep-link)
//   - "open_squad"  → focus existing tab, navigate to `data.url` with the
//                     `#comments` anchor appended
//   - "" (default body click) → focus existing tab, navigate to `data.url`
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data ?? {};
  const action = event.action;
  const baseUrl = typeof data.url === "string" ? data.url : "/";

  let target;
  if (action === "directions" && typeof data.directionsUrl === "string") {
    target = data.directionsUrl;
  } else if (action === "open_squad") {
    target = baseUrl.includes("#") ? baseUrl : `${baseUrl}#comments`;
  } else {
    target = baseUrl;
  }

  event.waitUntil(focusOrOpen(target));
});

async function focusOrOpen(target) {
  let parsed;
  try {
    parsed = new URL(target, self.location.origin);
  } catch {
    return;
  }

  // External destinations (e.g. maps deep-link) — always a new window.
  if (parsed.origin !== self.location.origin) {
    if (self.clients.openWindow) {
      await self.clients.openWindow(parsed.href);
    }
    return;
  }

  // If a Squad tab is already open, focus it and navigate there. Else
  // open a fresh window.
  const clientList = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of clientList) {
    if ("focus" in client) {
      await client.focus();
      if ("navigate" in client && client.url !== parsed.href) {
        try {
          await client.navigate(parsed.href);
        } catch {
          // Cross-origin or revoked — fall through to openWindow below.
        }
      }
      return;
    }
  }
  if (self.clients.openWindow) {
    await self.clients.openWindow(parsed.href);
  }
}

async function networkFirstNavigation(req) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(req);
    // Stash a copy of HTML responses so an offline reload of the same URL
    // renders the last seen page instead of bouncing to /offline. We don't
    // serve from this cache while online — network-first stays the policy
    // to avoid leaking another user's RSC payload after sign-out/in.
    if (
      res.ok &&
      (res.headers.get("content-type") ?? "").includes("text/html")
    ) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    const offline = await cache.match("/offline");
    if (offline) return offline;
    return new Response("Offline", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
