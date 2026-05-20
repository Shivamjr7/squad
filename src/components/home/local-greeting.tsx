"use client";

import { useEffect, useState } from "react";
import { greetingForHour } from "@/lib/greeting";

// Renders the time-of-day greeting using the viewer's *local* hour.
// Server-rendered output uses `initialHour` so the initial paint matches
// what the SSR pass would produce (avoids hydration mismatch); after
// mount we swap to `new Date().getHours()` which is the user's actual
// local time. On Vercel the server is UTC, so without this swap an IST
// user at 6pm would see "Good morning" (UTC=12:30).
export function LocalGreeting({ initialHour }: { initialHour: number }) {
  const [hour, setHour] = useState(initialHour);

  useEffect(() => {
    setHour(new Date().getHours());
  }, []);

  return <>{greetingForHour(hour)}</>;
}
