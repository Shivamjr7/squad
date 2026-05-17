import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  addDays,
  formatDateParam,
  startOfMonth,
  startOfWeekSunday,
} from "./calendar-date";
import type { AnnotatedCommitment } from "./calendar-conflicts";

// Standard 6×7 grid. Each cell shows up to three colored dots (one per
// plan); conflicts wrap the dot in a coral ring. Tapping a cell opens that
// day in Day view via a `?view=day&date=…` Link.

const DOT_LIMIT = 3;
const WEEKDAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: "short" });

export function MonthView({
  anchor,
  commitments,
  todayKey,
}: {
  anchor: Date;
  commitments: AnnotatedCommitment[];
  todayKey: string;
}) {
  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeekSunday(monthStart);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const currentMonth = monthStart.getMonth();
  const byDay = bucketByDay(commitments);
  // Sunday-to-Saturday header — use the first row to derive labels in the
  // viewer's locale.
  const headers = cells.slice(0, 7).map((d) => WEEKDAY_FMT.format(d).slice(0, 1));

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-ink/10 text-center text-[10px] uppercase tracking-wide text-ink-muted">
        {headers.map((h, i) => (
          <div key={i} className="py-1.5">
            {h}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell) => {
          const key = formatDateParam(cell);
          const dayItems = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          const inMonth = cell.getMonth() === currentMonth;
          return (
            <Link
              key={key}
              href={`/calendar?view=day&date=${key}`}
              className={cn(
                "flex aspect-square min-h-[52px] flex-col items-center justify-start gap-1 border-b border-r border-ink/5 px-1 py-1 text-xs transition-colors hover:bg-paper-card",
                !inMonth && "text-ink-muted/60",
                isToday && "bg-paper-card",
              )}
            >
              <span
                className={cn(
                  "font-serif text-sm leading-none",
                  isToday && "text-coral",
                )}
              >
                {cell.getDate()}
              </span>
              <div className="flex flex-wrap items-center justify-center gap-0.5">
                {dayItems.slice(0, DOT_LIMIT).map((item) => (
                  <span
                    key={item.planId}
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full",
                      item.circleColor,
                      item.conflict === "hard" &&
                        "ring-1 ring-coral ring-offset-1 ring-offset-paper",
                    )}
                  />
                ))}
                {dayItems.length > DOT_LIMIT ? (
                  <span className="text-[9px] leading-none text-ink-muted">
                    +{dayItems.length - DOT_LIMIT}
                  </span>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function bucketByDay(
  items: AnnotatedCommitment[],
): Map<string, AnnotatedCommitment[]> {
  const map = new Map<string, AnnotatedCommitment[]>();
  for (const item of items) {
    const key = formatDateParam(item.start);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}
