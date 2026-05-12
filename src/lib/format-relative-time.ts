// Conversational relative-time formatting for the cross-circle feed cards.
// formatPlanTime (in ./format-plan-time.ts) is more granular for the in-circle
// surfaces ("today, 8:00 PM" / "Sat 8:00 PM"); the feed needs a single short
// phrase that reads naturally in a stream ("Tonight 8pm", "In 2h",
// "Tomorrow 3pm").

function hour12(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: date.getMinutes() === 0 ? undefined : "2-digit",
    hour12: true,
    timeZone,
  })
    .format(date)
    .toLowerCase()
    .replace(/\s/g, "");
}

function weekdayShort(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    timeZone,
  }).format(date);
}

function isSameLocalDay(a: Date, b: Date, timeZone?: string): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  });
  return fmt.format(a) === fmt.format(b);
}

function isTomorrow(a: Date, now: Date, timeZone?: string): boolean {
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  return isSameLocalDay(a, t, timeZone);
}

// Future-only formatter — returns a short phrase suitable for the feed
// card status row. `now` is injected so callers can pin time for tests.
export function formatRelativePlanTime(
  startsAt: Date,
  now: Date,
  timeZone?: string,
): string {
  const diffMs = startsAt.getTime() - now.getTime();

  // Within the next 60 minutes — "In 22m", "In 1h"
  if (diffMs < 60 * 60_000) {
    const minutes = Math.max(1, Math.round(diffMs / 60_000));
    return minutes < 60 ? `In ${minutes}m` : `In 1h`;
  }

  // Same calendar day — "Tonight 8pm" if after 5pm local, else "Today 3pm"
  if (isSameLocalDay(startsAt, now, timeZone)) {
    const hour = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      hour12: false,
      timeZone,
    }).format(startsAt);
    const h = parseInt(hour, 10);
    const prefix = h >= 17 ? "Tonight" : "Today";
    return `${prefix} ${hour12(startsAt, timeZone)}`;
  }

  // Tomorrow — "Tomorrow 3pm"
  if (isTomorrow(startsAt, now, timeZone)) {
    return `Tomorrow ${hour12(startsAt, timeZone)}`;
  }

  // 2-6 days out — "Sat 9pm"
  const dayMs = 86_400_000;
  if (diffMs < 7 * dayMs) {
    return `${weekdayShort(startsAt, timeZone)} ${hour12(startsAt, timeZone)}`;
  }

  // Further out — "Jun 14"
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(startsAt);
}

// Past formatter — "Happened 2h ago", "Happened yesterday", "Happened Mon"
export function formatRelativePastTime(
  startsAt: Date,
  now: Date,
  timeZone?: string,
): string {
  const diffMs = now.getTime() - startsAt.getTime();
  if (diffMs < 60 * 60_000) {
    const minutes = Math.max(1, Math.round(diffMs / 60_000));
    return `Happened ${minutes}m ago`;
  }
  const hours = Math.round(diffMs / (60 * 60_000));
  if (hours < 24 && isSameLocalDay(startsAt, now, timeZone)) {
    return `Happened ${hours}h ago`;
  }
  // Yesterday
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (isSameLocalDay(startsAt, y, timeZone)) return "Happened yesterday";

  const dayMs = 86_400_000;
  if (diffMs < 7 * dayMs) {
    return `Happened ${weekdayShort(startsAt, timeZone)}`;
  }
  return `Happened ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(startsAt)}`;
}
