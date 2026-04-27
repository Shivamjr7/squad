"use client";

import { useEffect, useMemo, useState } from "react";
import { formatPlanTime } from "@/lib/format-plan-time";

// Renders the plan time using the viewer's local TZ. We defer formatting to
// useEffect so the first paint (server) doesn't lock in UTC text and then
// flicker on hydration — the placeholder dash matches both passes.
export function PlanTime({
  startsAt,
  isApproximate,
  className,
}: {
  startsAt: Date | string;
  isApproximate: boolean;
  className?: string;
}) {
  const date = useMemo(
    () => (startsAt instanceof Date ? startsAt : new Date(startsAt)),
    [startsAt],
  );
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    setText(formatPlanTime(date, isApproximate, new Date()));
  }, [date, isApproximate]);

  return (
    <time
      dateTime={date.toISOString()}
      className={className}
      suppressHydrationWarning
    >
      {text ?? "…"}
    </time>
  );
}
