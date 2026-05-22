import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, userAgent, type NextRequest } from "next/server";

// Per-request CSP. We generate a random nonce, thread it onto the request
// header so Next 15 can attach it to every <script> tag it emits, and
// also write it back on the response so subsequent inline scripts can
// reference it. 'strict-dynamic' tells modern browsers to ignore
// 'unsafe-inline' / host-allowlists when a valid nonce is present —
// providing real XSS protection on the modern web while degrading
// gracefully on older browsers (which fall back to the static CSP from
// next.config.ts).
//
// 'unsafe-eval' stays because Clerk's runtime uses it. Without it the
// auth widgets stop rendering.
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com https://va.vercel-scripts.com 'unsafe-inline'`,
    "worker-src 'self' blob:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.clerk.accounts.dev https://*.clerk.com https://va.vercel-scripts.com https://places.googleapis.com https://maps.googleapis.com",
    "img-src 'self' data: blob: https://img.clerk.com https://*.googleusercontent.com https://*.gstatic.com https://maps.googleapis.com https://maps.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "frame-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function makeNonce(): string {
  // 16 random bytes → base64, enough entropy for CSP nonces per spec.
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
}

function nextWithCsp(req: NextRequest): NextResponse {
  const nonce = makeNonce();
  const csp = buildCsp(nonce);
  // Build new request headers so RSC streaming sees x-nonce.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  // Mirror onto the response so the browser receives the CSP.
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("x-nonce", nonce);
  return res;
}

function redirectWithCsp(req: NextRequest, location: URL): NextResponse {
  const nonce = makeNonce();
  const csp = buildCsp(nonce);
  const res = NextResponse.redirect(location);
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("x-nonce", nonce);
  return res;
}

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/invite/(.*)",
  "/api/webhooks/(.*)",
  "/offline",
  // Legal + account-deletion pages must be reachable without auth — Google
  // Play reviewers fetch the privacy policy and account-deletion URLs from
  // the store listing while signed out.
  "/privacy",
  "/terms",
  "/delete-account",
  "/child-safety",
  // Digital Asset Links — Android fetches this unauthenticated to verify the
  // TWA owns this domain. Without it the TWA shows a URL bar.
  "/.well-known/(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // Mobile users hitting / unauthenticated → straight to sign-in. Same
  // pattern X / Instagram / LinkedIn use on mobile web: the marketing
  // landing exists for desktop discovery, but on a phone the app's first
  // surface should be auth.
  if (req.nextUrl.pathname === "/") {
    const { userId } = await auth();
    if (!userId && userAgent(req).device.type === "mobile") {
      const url = req.nextUrl.clone();
      url.pathname = "/sign-in";
      return redirectWithCsp(req, url);
    }
  }

  if (!isPublicRoute(req)) {
    await auth.protect();
  }
  // Continue with the request, attaching a per-request CSP that includes
  // a fresh nonce. The static CSP in next.config.ts remains as a fallback
  // for routes that bypass the matcher (mainly static assets).
  return nextWithCsp(req);
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
