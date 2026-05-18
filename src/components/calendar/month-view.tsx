import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  addDays,
  formatDateParam,
  startOfMonth,
  startOfWeekSunday,
} from "./calendar-date";
import type { AnnotatedCommitment } from "./calendar-conflicts";

// Standard 6×7 grid. Mobile (≤md) cells are too narrow for plan titles so
// they render the historical colored-dot row. Desktop (≥md) renders up
// to CHIP_LIMIT one-line title chips per cell (with the circle color as
// a leading dot), falling back to "+N" overflow text. Tapping a cell
// opens that day in Day view via `?view=day&date=…`.

const DOT_LIMIT = 3;
const CHIP_LIMIT = 3;
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
                "group flex aspect-square min-h-[52px] flex-col items-center justify-start gap-1 border-b border-r border-ink-hairline px-1 py-1 text-xs transition-colors md:aspect-auto md:min-h-[110px] md:items-stretch md:px-1.5 md:py-1.5",
                "hover:bg-paper-card",
                !inMonth && "text-ink-muted/60",
                // Today wash — soft coral fill so the focal cell pulls
                // the eye without competing with plan chips for color.
                isToday && "bg-coral-soft/60",
              )}
            >
              <span
                className={cn(
                  "font-serif text-sm leading-none md:self-start md:px-0.5",
                  isToday && "font-semibold text-coral-strong",
                )}
              >
                {cell.getDate()}
              </span>

              {/* Mobile: colored-dot row. Cells are ~50px wide, too narrow
                  for legible titles. */}
              <div className="flex flex-wrap items-center justify-center gap-0.5 md:hidden">
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

              {/* Desktop: one-line plan-title chips. Per UI/UX plan §4.5 —
                  cells at ≥md are tall and wide enough to carry text. */}
              <div className="mt-1 hidden min-w-0 flex-col gap-0.5 md:flex">
                {dayItems.slice(0, CHIP_LIMIT).map((item) => (
                  <span
                    key={item.planId}
                    className={cn(
                      "flex min-w-0 items-center gap-1 truncate rounded-md bg-paper/60 px-1.5 py-0.5 text-[11px] leading-tight text-ink/90",
                      // Hard conflict — coral outline so the user sees
                      // "two events here" at a glance.
                      item.conflict === "hard" && "ring-1 ring-coral/60",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        item.circleColor,
                      )}
                    />
                    <span className="truncate">{item.planTitle}</span>
                  </span>
                ))}
                {dayItems.length > CHIP_LIMIT ? (
                  <span className="px-1.5 text-[10px] text-ink-muted">
                    +{dayItems.length - CHIP_LIMIT} more
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
