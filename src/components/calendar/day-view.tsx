"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { addDays, formatDateParam } from "./calendar-date";
import type { AnnotatedCommitment } from "./calendar-conflicts";

// Day view — best surface at 380px. Hour rail down the left. When the host
// passes `onSlotPick`, every hour from 7am–11pm is rendered as a tap target;
// otherwise the read-only collapse-to-busy-hours layout from M32 stays.

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const START_HOUR = 7;
const END_HOUR = 24; // exclusive; renders 7am–11pm

function hourLabel(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${suffix}`;
}

export function DayView({
  anchor,
  commitments,
  onSlotPick,
}: {
  anchor: Date;
  commitments: AnnotatedCommitment[];
  // When set, every hour row is a tap target that resolves to the top of
  // that hour as a viewer-local Date and calls this. Plan cards inside a
  // bucket stop propagation so tapping a plan still navigates to it.
  onSlotPick?: (date: Date) => void;
}) {
  const dayStart = anchor.getTime();
  const dayEnd = addDays(anchor, 1).getTime();
  const dayKey = formatDateParam(anchor);

  const items = commitments
    .filter((it) => it.start.getTime() < dayEnd && it.end.getTime() > dayStart)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Interactive mode: render the full 7am–11pm rail. Each hour with no plan
  // becomes a single "+ Add plan" tap target; hours with plans show the
  // cards stacked. This matches the WeekView interaction model while
  // staying readable at 380px.
  if (onSlotPick) {
    const byHour = bucketByHour(items);
    const hourMap = new Map(byHour.map((b) => [b.hour, b]));
    const hours = Array.from(
      { length: END_HOUR - START_HOUR },
      (_, i) => START_HOUR + i,
    );

    function pickHour(h: number) {
      const picked = new Date(anchor);
      picked.setHours(h, 0, 0, 0);
      onSlotPick!(picked);
    }

    return (
      <ol className="flex flex-col">
        {hours.map((h) => {
          const bucket = hourMap.get(h);
          return (
            <li
              key={h}
              className="flex min-h-[56px] gap-3 border-t border-ink/15 first:border-t-0"
            >
              <div className="w-12 shrink-0 pt-2 text-right text-[11px] uppercase tracking-wide text-ink-muted">
                {hourLabel(h)}
              </div>
              <div className="flex min-w-0 flex-1 py-1.5">
                {bucket ? (
                  <ol className="flex min-w-0 flex-1 flex-col gap-2">
                    {bucket.items.map((item) => (
                      <DayCard
                        key={item.planId}
                        item={item}
                        dayKey={dayKey}
                        // Tap on a card lands on the plan — stop the
                        // bubble so the row's "+ Add" handler doesn't
                        // also fire and spawn a sheet for this hour.
                        onCardClick={(e) => e.stopPropagation()}
                      />
                    ))}
                  </ol>
                ) : (
                  <button
                    type="button"
                    onClick={() => pickHour(h)}
                    aria-label={`Create a plan at ${hourLabel(h)}`}
                    className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ink-muted/0 transition-colors hover:bg-paper-card hover:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:text-ink-muted"
                  >
                    <Plus
                      className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                      aria-hidden
                    />
                    <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      Add a plan at {hourLabel(h)}
                    </span>
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    );
  }

  // Read-only path — preserved verbatim from pre-#2 behavior so non-launcher
  // callers (none today, but the prop is optional for back-compat) still see
  // the collapsed-hour layout.
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink/15 px-4 py-12 text-center text-sm text-ink-muted">
        Nothing on the books for{" "}
        <span className="font-serif italic">
          {new Intl.DateTimeFormat(undefined, {
            weekday: "long",
          }).format(anchor)}
        </span>
        .
      </div>
    );
  }

  const buckets = bucketByHour(items);

  return (
    <ol className="flex flex-col gap-4">
      {buckets.map((bucket) => (
        <li key={bucket.hourLabel} className="flex gap-3">
          <div className="w-12 shrink-0 pt-2 text-right text-[11px] uppercase tracking-wide text-ink-muted">
            <div>{bucket.hourLabel}</div>
          </div>
          <ol className="flex min-w-0 flex-1 flex-col gap-2">
            {bucket.items.map((item) => (
              <DayCard key={item.planId} item={item} dayKey={dayKey} />
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}

function bucketByHour(items: AnnotatedCommitment[]): {
  hour: number;
  hourLabel: string;
  items: AnnotatedCommitment[];
}[] {
  const out: {
    hour: number;
    hourLabel: string;
    items: AnnotatedCommitment[];
  }[] = [];
  for (const item of items) {
    const h = item.start.getHours();
    const last = out[out.length - 1];
    if (last && last.hour === h) {
      last.items.push(item);
    } else {
      out.push({ hour: h, hourLabel: hourLabel(h), items: [item] });
    }
  }
  return out;
}

function DayCard({
  item,
  dayKey,
  onCardClick,
}: {
  item: AnnotatedCommitment;
  dayKey: string;
  // Optional click handler — interactive day view uses this to stopPropagation
  // so a tap on the card navigates to the plan rather than firing the row's
  // hour-tap target underneath.
  onCardClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const conflict = item.conflict;
  const start = TIME_FMT.format(item.start);
  // Only show end time when it lands on the same calendar day; multi-day
  // plans aren't a real scenario but the guard keeps the UI honest.
  const endSameDay = formatDateParam(item.end) === dayKey;
  const end = endSameDay ? TIME_FMT.format(item.end) : null;

  return (
    <Link
      href={`/c/${item.circleSlug}/p/${item.planId}`}
      onClick={onCardClick}
      className={cn(
        "group relative flex flex-col gap-1 rounded-lg border border-ink/10 bg-paper-card px-3 py-2.5 transition-colors hover:border-ink/20",
        conflict === "hard" && "border-l-4 border-l-coral",
      )}
    >
      {conflict === "hard" ? (
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-coral">
          Double booked
        </span>
      ) : null}
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", item.circleColor)} />
        <span className="font-serif text-base leading-tight text-ink">
          {start}
          {end ? <span className="text-ink-muted"> – {end}</span> : null}
        </span>
        {conflict === "soft" ? (
          <span
            aria-hidden
            className="ml-auto size-1.5 shrink-0 rounded-full bg-coral/60"
            title="Soft conflict"
          />
        ) : null}
      </div>
      <div className="text-sm font-medium text-ink">{item.planTitle}</div>
      <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
        <span className="truncate">{item.circleName}</span>
        {item.location ? (
          <>
            <span aria-hidden>·</span>
            <span className="truncate">{item.location}</span>
          </>
        ) : null}
        {item.vote === "maybe" ? (
          <span className="ml-auto shrink-0 rounded-full bg-maybe/15 px-1.5 py-0.5 text-[10px] uppercase text-maybe">
            Maybe
          </span>
        ) : null}
      </div>
    </Link>
  );
}
