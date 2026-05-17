import Link from "next/link";
import { cn } from "@/lib/utils";
import { addDays, formatDateParam } from "./calendar-date";
import type { AnnotatedCommitment } from "./calendar-conflicts";

// Day view — best surface at 380px. Hour rail down the left, plans as
// full-width cards. Hours collapse: only hours that hold (or directly
// neighbour) a plan are rendered, so the screen stays tight.

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export function DayView({
  anchor,
  commitments,
}: {
  anchor: Date;
  commitments: AnnotatedCommitment[];
}) {
  const dayStart = anchor.getTime();
  const dayEnd = addDays(anchor, 1).getTime();
  const dayKey = formatDateParam(anchor);

  const items = commitments
    .filter((it) => it.start.getTime() < dayEnd && it.end.getTime() > dayStart)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

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

  // Group adjacent plans by hour bucket so we can render an hour rail label
  // once per cluster. Plans inside the same hour show with their precise
  // start time on the card.
  const buckets = bucketByHour(items);

  return (
    <ol className="flex flex-col gap-4">
      {buckets.map((bucket) => (
        <li key={bucket.hourKey} className="flex gap-3">
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
  hourKey: string;
  hourLabel: string;
  items: AnnotatedCommitment[];
}[] {
  const out: {
    hourKey: string;
    hourLabel: string;
    items: AnnotatedCommitment[];
  }[] = [];
  for (const item of items) {
    const h = item.start.getHours();
    const suffix = h >= 12 ? "PM" : "AM";
    const display = h % 12 === 0 ? 12 : h % 12;
    const hourLabel = `${display} ${suffix}`;
    const last = out[out.length - 1];
    if (last && last.hourKey === hourLabel) {
      last.items.push(item);
    } else {
      out.push({ hourKey: hourLabel, hourLabel, items: [item] });
    }
  }
  return out;
}

function DayCard({
  item,
  dayKey,
}: {
  item: AnnotatedCommitment;
  dayKey: string;
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
