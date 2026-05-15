"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Tiny client component that warms the Next router cache for the user's
// most-recent circle as soon as the cross-circle home (`/`) renders. The
// vast majority of taps from that page land on this circle — by the time
// the user reads the row and taps, the RSC payload + loading.tsx chunk
// are already cached, so the transition is effectively instant.
export function PrefetchCircle({ slug }: { slug: string }) {
  const router = useRouter();
  useEffect(() => {
    router.prefetch(`/c/${slug}`);
  }, [router, slug]);
  return null;
}
