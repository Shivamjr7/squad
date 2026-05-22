import type { NextConfig } from "next";

// Static (non-CSP) security headers. CSP is set per-request from
// middleware.ts so it can carry a fresh nonce that Next 15 threads into
// every emitted <script>. The rest of these don't vary per request and
// belong at the edge.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  experimental: {
    viewTransition: true,
  },
  // Hide the dev "N" indicator entirely. Any bottom corner overlaps the
  // mobile bottom-tab bar (Home / You) and any top corner overlaps the
  // AppShell top bar — there's nowhere to put it on a 380px viewport
  // without it reading as a stray UI element on screenshots. Stripped
  // from production builds either way.
  devIndicators: false,
  // Avatars come from Clerk's CDN and Google profile images via Clerk.
  // Without the allowlist, the Vercel image optimizer would fetch any URL
  // the server sees — SSRF via a crafted avatar URL.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "img.clerk.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
