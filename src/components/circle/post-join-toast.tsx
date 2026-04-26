"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

export function PostJoinToast() {
  const params = useSearchParams();
  const router = useRouter();
  const joined = params.get("joined");

  useEffect(() => {
    if (!joined) return;
    if (joined === "new") toast.success("You're in! Welcome.");
    else if (joined === "existing") toast.info("You're already in this circle.");
    // Strip the param so toast doesn't refire on refresh.
    router.replace(window.location.pathname, { scroll: false });
  }, [joined, router]);

  return null;
}
