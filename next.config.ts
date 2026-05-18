import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    viewTransition: true,
  },
  // Next 15 dev indicator defaults to bottom-right, which collides with our
  // mobile "+ New plan" FAB during local development. Move it to bottom-left
  // so designers reviewing the mobile viewport in DevTools don't mistake it
  // for a production overlap bug. (No effect on production builds — Next
  // strips this overlay in `next build`.)
  devIndicators: {
    position: "bottom-left",
  },
};

export default nextConfig;
