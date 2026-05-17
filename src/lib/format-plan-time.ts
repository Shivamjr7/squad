// Pure formatter for a plan's start time. The `now` argument is injected so
// callers can pin time for testing. `timeZone` is REQUIRED — every plan
// carries an IANA zone (plans.time_zone, NOT NULL, default UTC), and rendering
// in any zone other than the plan's drifts the displayed hour from what the
// creator picked. Callers MUST pass plan.timeZone, never undefined / browser
// default.
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


function formatTime(date: Date, timeZone?: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

function formatWeekday(date: Date, timeZone?: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    timeZone,
  }).format(date);
}

function formatMonthDay(date: Date, timeZone?: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
}

function formatMonthDayYear(date: Date, timeZone?: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(date);
}

function formatYmd(date: Date, timeZone?: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(date);
}

function isSameLocalDay(a: Date, b: Date, timeZone?: string): boolean {
  return formatYmd(a, timeZone) === formatYmd(b, timeZone);
}

function isWeekendLocal(d: Date, timeZone?: string): boolean {
  const dow = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    timeZone,
  }).formatToParts(d).find((part) => part.type === "weekday")?.value;
  return dow === "Sun" || dow === "Sat";
}

export function formatPlanTime(
  startsAt: Date,
  isApproximate: boolean,
  now: Date,
  timeZone: string,
): string {
  const diffMs = startsAt.getTime() - now.getTime();
  const isPast = diffMs < 0;
  const dayMs = 86_400_000;

  if (isApproximate) {
    if (isPast) return formatMonthDayYear(startsAt, timeZone);
    if (diffMs < 7 * dayMs && isWeekendLocal(startsAt, timeZone)) return "this weekend";
    if (diffMs < 14 * dayMs) return "next week";
    return formatMonthDay(startsAt, timeZone);
  }

  if (isPast) return formatMonthDayYear(startsAt, timeZone);
  if (isSameLocalDay(startsAt, now, timeZone)) {
    return `today, ${formatTime(startsAt, timeZone)}`;
  }
  if (diffMs < 7 * dayMs) {
    return `${formatWeekday(startsAt, timeZone)} ${formatTime(startsAt, timeZone)}`;
  }
  return `${formatMonthDay(startsAt, timeZone)}, ${formatTime(startsAt, timeZone)}`;
}
