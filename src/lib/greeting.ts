// Time-of-day greeting buckets. Pure function so the same logic runs
// on the server (initial paint, with a server hour that may be wrong
// for the viewer's timezone) and on the client (after hydration, with
// the viewer's actual local hour).
export function greetingForHour(hour: number): string {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
