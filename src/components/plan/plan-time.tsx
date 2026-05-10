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
  timeZone?: string;
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
