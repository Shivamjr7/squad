"use client";

import { useEffect, useMemo, useState } from "react";
import { formatPlanTime } from "@/lib/format-plan-time";

export function PlanTime({
  startsAt,
  isApproximate,
  className,
  timeZone,
}: {
  startsAt: Date | string;
  isApproximate: boolean;
  className?: string;
  // Required. The plan's IANA zone (plans.time_zone, NOT NULL). Passing the
  // viewer's browser zone here would drift the rendered hour from what the
  // creator picked and what the rest of the app shows.
  timeZone: string;
}) {
  const date = useMemo(
    () => (startsAt instanceof Date ? startsAt : new Date(startsAt)),
    [startsAt],
  );
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    setText(formatPlanTime(date, isApproximate, new Date(), timeZone));
  }, [date, isApproximate, timeZone]);

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
