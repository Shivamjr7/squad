import Link from "next/link";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type CalendarView,
  addDays,
  addMonths,
  formatDateParam,
  startOfDayLocal,
  startOfMonth,
  startOfWeekSunday,
  windowForView,
} from "./calendar-date";

// Built as Links so server-rendering the whole calendar is enough — no
// client state for view switching, nav, or jump-to-today. Active state is
// purely a prop derived from the page's current `view`.

function buildHref(view: CalendarView, date: Date): string {
  const params = new URLSearchParams({
    view,
    date: formatDateParam(date),
  });
  return `/calendar?${params.toString()}`;
}

function shiftAnchor(view: CalendarView, anchor: Date, direction: -1 | 1): Date {
  if (view === "day") return addDays(anchor, direction);
  if (view === "week") return addDays(anchor, direction * 7);
  return addMonths(anchor, direction);
}

function rangeLabel(view: CalendarView, anchor: Date): string {
  if (view === "day") {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    }).format(anchor);
  }
  if (view === "week") {
    const start = startOfWeekSunday(anchor);
    const end = addDays(start, 6);
    const sameMonth = start.getMonth() === end.getMonth();
    if (sameMonth) {
      return `${new Intl.DateTimeFormat(undefined, {
        month: "short",
      }).format(start)} ${start.getDate()}–${end.getDate()}`;
    }
    const startFmt = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(start);
    const endFmt = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(end);
    return `${startFmt} – ${endFmt}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(startOfMonth(anchor));
}

export function CalendarControls({
  view,
  anchor,
}: {
  view: CalendarView;
  anchor: Date;
}) {
  const today = startOfDayLocal(new Date());
  const prev = shiftAnchor(view, anchor, -1);
  const next = shiftAnchor(view, anchor, 1);
  // M32.6 — the ICS download covers exactly the visible window. We strip
  // the day-buffer that `windowForView` adds for TZ slop because the export
  // is the user's commitment range, not the server's fetch range.
  const { from: rawFrom, to: rawTo } = windowForView(view, anchor);
  const icsFrom = formatDateParam(addDays(rawFrom, 1));
  const icsTo = formatDateParam(addDays(rawTo, -1));
  const icsHref = `/api/calendar/ics?from=${icsFrom}&to=${icsTo}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-serif text-2xl font-semibold italic text-ink sm:text-3xl">
          {rangeLabel(view, anchor)}
        </h1>
        <div className="flex items-center gap-2">
          <a
            href={icsHref}
            download="squad-calendar.ics"
            className="hidden items-center gap-1 rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted transition-colors hover:text-ink sm:inline-flex"
          >
            <CalendarPlus className="size-3.5" aria-hidden />
            Calendar
          </a>
          <Link
            href={buildHref(view, today)}
            className="rounded-full border border-ink/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted transition-colors hover:text-ink"
          >
            Today
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <ViewToggle view={view} anchor={anchor} />
        <div className="flex items-center gap-1">
          <a
            href={icsHref}
            download="squad-calendar.ics"
            aria-label="Export to calendar"
            className="flex size-9 items-center justify-center rounded-full border border-ink/15 text-ink-muted transition-colors hover:text-ink sm:hidden"
          >
            <CalendarPlus className="size-4" aria-hidden />
          </a>
          <Link
            href={buildHref(view, prev)}
            aria-label="Previous"
            className="flex size-9 items-center justify-center rounded-full border border-ink/15 text-ink-muted transition-colors hover:text-ink"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
          <Link
            href={buildHref(view, next)}
            aria-label="Next"
            className="flex size-9 items-center justify-center rounded-full border border-ink/15 text-ink-muted transition-colors hover:text-ink"
          >
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}

const TOGGLE_ITEMS: { view: CalendarView; label: string }[] = [
  { view: "week", label: "Week" },
  { view: "day", label: "Day" },
  { view: "month", label: "Month" },
];

function ViewToggle({
  view: activeView,
  anchor,
}: {
  view: CalendarView;
  anchor: Date;
}) {
  return (
    <nav
      aria-label="Calendar view"
      className="inline-flex items-center gap-0.5 rounded-full border border-ink/10 bg-paper-card p-0.5"
    >
      {TOGGLE_ITEMS.map((item) => {
        const active = item.view === activeView;
        return (
          <Link
            key={item.view}
            href={buildHref(item.view, anchor)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              active
                ? "bg-ink text-paper"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
