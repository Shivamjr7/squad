// Date math for the /calendar surface. Pure functions, no Date library —
// week starts Sunday (US/India default; matches Intl in most en locales).
//
// All operations work in server-local time. On Vercel that's UTC, which is
// fine for picking a calendar window — over-fetch by a day on each side
// covers the off-by-one a non-UTC viewer sees right around midnight.

export type CalendarView = "week" | "day" | "month";

export function isCalendarView(s: string | undefined): s is CalendarView {
  return s === "week" || s === "day" || s === "month";
}

export function startOfDayLocal(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfWeekSunday(d: Date): Date {
  const x = startOfDayLocal(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function startOfMonth(d: Date): Date {
  const x = startOfDayLocal(d);
  x.setDate(1);
  return x;
}

export function endOfMonth(d: Date): Date {
  const x = startOfDayLocal(d);
  x.setMonth(x.getMonth() + 1, 1);
  return x; // exclusive — first instant of next month
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

// "YYYY-MM-DD" in server-local time. Used as the canonical `?date=` param
// and as a stable key for "is this the same calendar day?" comparisons.
export function formatDateParam(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dy}`;
}

export function parseDateParam(s: string | undefined | null): Date {
  if (!s) return startOfDayLocal(new Date());
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return startOfDayLocal(new Date());
  const [, y, mo, dy] = m;
  return new Date(Number(y), Number(mo) - 1, Number(dy));
}

// Returns the [from, to) window the server should fetch for a given view +
// anchor date. Half-open like the rest of the conflict pipeline. Buffered
// by a day on each side so the viewer's local week still renders cleanly
// when their TZ leans east/west of the server's.
export function windowForView(
  view: CalendarView,
  anchor: Date,
): { from: Date; to: Date } {
  if (view === "day") {
    return {
      from: addDays(startOfDayLocal(anchor), -1),
      to: addDays(startOfDayLocal(anchor), 2),
    };
  }
  if (view === "week") {
    const start = startOfWeekSunday(anchor);
    return {
      from: addDays(start, -1),
      to: addDays(start, 8),
    };
  }
  // month — 6 weeks centered on the month so the grid always has 42 cells.
  const firstOfMonth = startOfMonth(anchor);
  const gridStart = startOfWeekSunday(firstOfMonth);
  return {
    from: addDays(gridStart, -1),
    to: addDays(gridStart, 43),
  };
}
