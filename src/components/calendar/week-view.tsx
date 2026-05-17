import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  addDays,
  formatDateParam,
  startOfWeekSunday,
} from "./calendar-date";
import type { AnnotatedCommitment } from "./calendar-conflicts";

// Week view — 7 columns × hour rows, vertical scroll. Mobile target 380px:
// each column is ~50px after the hour rail; we render two-letter weekday
// headers and rely on the per-plan block to show the title via truncation.
// Today's column is tinted via `bg-paper-card`.

const HOUR_HEIGHT_PX = 56; // mobile-tight 14×4 ≈ readable at 380px
const START_HOUR = 7;
const END_HOUR = 24; // exclusive; renders 7am–11pm

const HOUR_LABELS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => {
  const h = START_HOUR + i;
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${suffix}`;
});

const WEEKDAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: "short" });

export function WeekView({
  anchor,
  commitments,
  todayKey,
}: {
  anchor: Date;
  commitments: AnnotatedCommitment[];
  todayKey: string;
}) {
  const start = startOfWeekSunday(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const byDay = bucketByDay(commitments, days);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))] border-b border-ink/10 bg-paper text-xs">
          <div />
          {days.map((d) => {
            const isToday = formatDateParam(d) === todayKey;
            return (
              <div
                key={d.toISOString()}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2",
                  isToday && "bg-paper-card",
                )}
              >
                <span className="uppercase tracking-wide text-ink-muted">
                  {WEEKDAY_FMT.format(d).slice(0, 2)}
                </span>
                <span
                  className={cn(
                    "font-serif text-lg leading-none",
                    isToday ? "text-coral" : "text-ink",
                  )}
                >
                  {d.getDate()}
                </span>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))]">
          <div>
            {HOUR_LABELS.map((label) => (
              <div
                key={label}
                className="h-[56px] border-t border-ink/5 pr-1 pt-1 text-right text-[10px] text-ink-muted"
              >
                {label}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const isToday = formatDateParam(d) === todayKey;
            return (
              <DayColumn
                key={d.toISOString()}
                day={d}
                items={byDay.get(formatDateParam(d)) ?? []}
                tinted={isToday}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function bucketByDay(
  items: AnnotatedCommitment[],
  days: Date[],
): Map<string, AnnotatedCommitment[]> {
  const byDay = new Map<string, AnnotatedCommitment[]>();
  for (const day of days) {
    byDay.set(formatDateParam(day), []);
  }
  const dayStarts = days.map((d) => d.getTime());
  const dayEnds = days.map((d) => addDays(d, 1).getTime());

  for (const item of items) {
    for (let i = 0; i < days.length; i += 1) {
      if (item.start.getTime() < dayEnds[i]! && item.end.getTime() > dayStarts[i]!) {
        byDay.get(formatDateParam(days[i]!))?.push(item);
      }
    }
  }
  return byDay;
}

function DayColumn({
  day,
  items,
  tinted,
}: {
  day: Date;
  items: AnnotatedCommitment[];
  tinted: boolean;
}) {
  const dayStartMs = day.getTime();
  const trackHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT_PX;
  const visibleStartMs = dayStartMs + START_HOUR * 3_600_000;
  const visibleEndMs = dayStartMs + END_HOUR * 3_600_000;

  // Plans clip to the visible 7am–11pm band. Anything wholly outside the
  // band is dropped; partial overlap is rendered at the boundary so the user
  // still sees something they can tap.
  const visible = items
    .filter(
      (it) =>
        it.start.getTime() < visibleEndMs && it.end.getTime() > visibleStartMs,
    )
    .map((it) => {
      const startMs = Math.max(it.start.getTime(), visibleStartMs);
      const endMs = Math.min(it.end.getTime(), visibleEndMs);
      const top =
        ((startMs - visibleStartMs) / 3_600_000) * HOUR_HEIGHT_PX;
      const height = Math.max(
        18,
        ((endMs - startMs) / 3_600_000) * HOUR_HEIGHT_PX - 2,
      );
      return { item: it, top, height };
    });

  // Side-by-side layout when two items overlap within the visible band.
  // We group by transitive overlap so 3+ stacked plans split evenly. Tiny n,
  // O(n²) is fine.
  const groups = groupOverlaps(visible);

  return (
    <div
      className={cn(
        "relative border-l border-ink/5",
        tinted && "bg-paper-card",
      )}
      style={{ height: `${trackHeight}px` }}
    >
      {Array.from({ length: END_HOUR - START_HOUR }).map((_, i) => (
        <div
          key={i}
          className="absolute inset-x-0 border-t border-ink/5"
          style={{ top: `${i * HOUR_HEIGHT_PX}px` }}
        />
      ))}
      {groups.map((group, gi) =>
        group.map((entry, idx) => {
          const widthPct = 100 / group.length;
          return (
            <CalendarBlock
              key={`${gi}:${entry.item.planId}`}
              entry={entry}
              widthPct={widthPct}
              leftPct={widthPct * idx}
              split={group.length > 1}
            />
          );
        }),
      )}
    </div>
  );
}

type PlacedEntry = {
  item: AnnotatedCommitment;
  top: number;
  height: number;
};

function groupOverlaps(entries: PlacedEntry[]): PlacedEntry[][] {
  const sorted = [...entries].sort((a, b) => a.top - b.top);
  const groups: PlacedEntry[][] = [];
  for (const entry of sorted) {
    const last = groups[groups.length - 1];
    if (last && entry.top < last[last.length - 1]!.top + last[last.length - 1]!.height) {
      last.push(entry);
    } else {
      groups.push([entry]);
    }
  }
  return groups;
}

function CalendarBlock({
  entry,
  widthPct,
  leftPct,
  split,
}: {
  entry: PlacedEntry;
  widthPct: number;
  leftPct: number;
  split: boolean;
}) {
  const { item, top, height } = entry;
  const conflict = item.conflict;
  return (
    <Link
      href={`/c/${item.circleSlug}/p/${item.planId}`}
      className={cn(
        "absolute overflow-hidden rounded-md border border-ink/5 bg-paper px-1.5 py-1 text-[11px] leading-tight shadow-sm transition-colors hover:bg-paper-card",
        conflict === "hard" && "ring-1 ring-coral",
      )}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
      }}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-1 left-0 w-1 rounded-r",
          item.circleColor,
        )}
      />
      <span className="ml-2 block truncate font-medium text-ink">
        {item.planTitle}
      </span>
      {!split && height > 38 && (
        <span className="ml-2 block truncate text-[10px] text-ink-muted">
          {item.location ?? item.circleName}
        </span>
      )}
    </Link>
  );
}
