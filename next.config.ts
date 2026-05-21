import type { NextConfig } from "next";

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
};

export default nextConfig;
