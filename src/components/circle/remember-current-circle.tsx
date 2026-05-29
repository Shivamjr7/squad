"use client";

import { useEffect } from "react";
import { LAST_CIRCLE_COOKIE } from "@/lib/circle-memory";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export function RememberCurrentCircle({ slug }: { slug: string }) {
  useEffect(() => {
    document.cookie = `${LAST_CIRCLE_COOKIE}=${encodeURIComponent(
      slug,
    )}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
  }, [slug]);

  return null;
}
