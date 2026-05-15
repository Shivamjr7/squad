// Squad service worker (M26, push handlers added M30).
// Goal: make the app installable as a real PWA, keep static assets fast,
// and surface Web Push notifications when the edge function fans them out.
// Non-goal: serving authenticated dynamic content while offline — that lives
// in the network. We only fall back to a tiny offline shell when nav fails.
//
// Bump CACHE_VERSION whenever the precache list changes to invalidate.
const CACHE_VERSION = "squad-shell-v3";
const PRECACHE = [
  "/offline",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE)),
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

// ─── Web Push (M30) ─────────────────────────────────────────────────────
// The edge function `send-push` posts an AES-128-GCM-encrypted payload to
// the user's push endpoint. The browser decrypts and hands us the JSON via
// event.data. Shape (kept in sync with lib/notifications.ts):
//   { title, body, url, tag? }
self.addEventListener("push", (event) => {
  let data = { title: "Squad", body: "" };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // Non-JSON payload — show a generic notification rather than swallowing.
    data = { title: "Squad", body: event.data?.text?.() ?? "" };
  }

  const title = typeof data.title === "string" ? data.title : "Squad";
  const body = typeof data.body === "string" ? data.body : "";
  const url = typeof data.url === "string" ? data.url : "/";
  const tag = typeof data.tag === "string" ? data.tag : undefined;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    (async () => {
      // If a Squad tab is already open, focus it and navigate there. Else
      // open a fresh window.
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client && client.url !== url) {
            try {
              await client.navigate(url);
            } catch {
              // Cross-origin or revoked — fall through to openWindow below.
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })(),
  );
});

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
