// Pure formatter for a plan's start time. The `now` argument is injected so
// callers can pin time for testing. Uses Intl.DateTimeFormat in the runtime's
// local zone (which is the viewer's zone when called client-side via PlanTime).
//
// Cases:
//   approximate, past               → "Apr 22, 2026"
//   approximate, ≤7d & weekend day  → "this weekend"
//   approximate, ≤14d               → "next week"
//   approximate, else               → "Apr 26"
//   exact,       past               → "Apr 22, 2026" (no time)
//   exact,       same calendar day  → "today, 8:00 PM"
//   exact,       ≤7d                → "Sat 8:00 PM"
//   exact,       else               → "Apr 26, 8:00 PM"

const time = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const monthDay = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const monthDayYear = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const ymd = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function isSameLocalDay(a: Date, b: Date): boolean {
  return ymd.format(a) === ymd.format(b);
}

function isWeekendLocal(d: Date): boolean {
  // 0 = Sun, 6 = Sat in the runtime's local zone.
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

export function formatPlanTime(
  startsAt: Date,
  isApproximate: boolean,
  now: Date,
): string {
  const diffMs = startsAt.getTime() - now.getTime();
  const isPast = diffMs < 0;
  const dayMs = 86_400_000;

  if (isApproximate) {
    if (isPast) return monthDayYear.format(startsAt);
    if (diffMs < 7 * dayMs && isWeekendLocal(startsAt)) return "this weekend";
    if (diffMs < 14 * dayMs) return "next week";
    return monthDay.format(startsAt);
  }

  if (isPast) return monthDayYear.format(startsAt);
  if (isSameLocalDay(startsAt, now)) return `today, ${time.format(startsAt)}`;
  if (diffMs < 7 * dayMs) {
    return `${weekday.format(startsAt)} ${time.format(startsAt)}`;
  }
  return `${monthDay.format(startsAt)}, ${time.format(startsAt)}`;
}
