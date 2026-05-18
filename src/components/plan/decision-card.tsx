import { DecisionCountCard } from "./decision-count-card";
import { PlanDeepLinks } from "./plan-deeplinks";
import { WalkingTimeHint } from "./walking-time-hint";

function formatShortTime(date: Date, timeZone?: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

const SHORT_DAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });

function isSameLocalDay(a: Date, b: Date, timeZone?: string): boolean {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(d);

  return fmt(a) === fmt(b);
}

function dayDescriptor(startsAt: Date, now: Date, timeZone?: string): string {
  const localHour = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone,
  }).format(startsAt);
  const h = Number(localHour);
  if (isSameLocalDay(startsAt, now, timeZone)) {
    if (h >= 18) return "tonight";
    if (h >= 12) return "this afternoon";
    return "this morning";
  }
  const dayMs = 86_400_000;
  const diffDays = Math.round(
    (startsAt.getTime() - now.getTime()) / dayMs,
  );
  if (diffDays === 1) return "tomorrow";
  if (diffDays > 1 && diffDays < 7) return SHORT_DAY.format(startsAt);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(startsAt);
}

type Props = {
  planId: string;
  startsAt: Date;
  timeZone?: string;
  isApproximate: boolean;
  location: string | null;
  showVenueVote: boolean; // when multi-venue voting is open, defer to that
  lockThreshold: number;
  recipientCount: number;
  decideBy: Date | null;
  // M25 — deep links computed server-side (UA-aware maps URL); null when
  // the plan has no location yet (still wires calendar links).
  mapsUrl: string | null;
  // Callers pass null for past plans — PlanDeepLinks hides the calendar
  // buttons accordingly. See lib/effective-status.ts.
  icsUrl: string | null;
  gcalUrl: string | null;
  now: Date;
};

// M31 — variant A of the plan-detail surface. Three vertically-stacked
// cards: the live count + lock copy (DecisionCountCard), then a 2-col
// WHEN | WHERE row of mini-cards. The deep-links cluster sits below the
// WHERE card so Maps + calendar tap-outs stay accessible without
// crowding the venue copy.
export function DecisionCard({
  planId,
  startsAt,
  timeZone,
  isApproximate,
  location,
  showVenueVote,
  lockThreshold,
  recipientCount,
  decideBy,
  mapsUrl,
  icsUrl,
  gcalUrl,
  now,
}: Props) {
  let bigTime = "";
  let smallTime = "";
  if (isApproximate) {
    bigTime = formatShortTime(startsAt, timeZone);
  } else {
    const parts = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    }).formatToParts(startsAt);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "";
    const ampm =
      parts.find((p) => p.type === "dayPeriod")?.value?.toUpperCase() ?? "";
    bigTime = `${hour}:${minute}`;
    smallTime = `${ampm} ${dayDescriptor(startsAt, now, timeZone)}`;
  }

  return (
    <div className="flex flex-col gap-3">
      <DecisionCountCard
        planId={planId}
        lockThreshold={lockThreshold}
        recipientCount={recipientCount}
        decideBy={decideBy?.toISOString() ?? null}
        timeZone={timeZone}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2">
        <section className="flex flex-col gap-1 rounded-2xl bg-paper-card p-4 shadow-card">
          <span className="eyebrow text-ink-muted">When</span>
          <div className="flex items-baseline gap-1.5">
            <span className="font-serif text-3xl font-semibold leading-none text-ink">
              {bigTime}
            </span>
            {smallTime ? (
              <span className="text-[11px] uppercase tracking-wide text-ink-muted">
                {smallTime.split(" ")[0]}
              </span>
            ) : null}
          </div>
          {smallTime ? (
            <span className="text-xs text-ink-muted">
              {smallTime.split(" ").slice(1).join(" ")}
            </span>
          ) : null}
        </section>

        <section className="flex flex-col gap-1 rounded-2xl bg-paper-card p-4 shadow-card">
          <span className="eyebrow text-ink-muted">Where</span>
          {showVenueVote ? (
            <span className="text-sm text-ink-muted">Voting on venue ↓</span>
          ) : location ? (
            <>
              <span className="truncate text-base font-medium text-ink">
                {location}
              </span>
              <WalkingTimeHint
                location={location}
                className="text-xs text-ink-muted"
              />
            </>
          ) : (
            <span className="text-sm text-ink-muted">Location TBD</span>
          )}
        </section>
      </div>

      {!showVenueVote ? (
        <PlanDeepLinks
          mapsUrl={mapsUrl}
          icsUrl={icsUrl}
          gcalUrl={gcalUrl}
          location={location}
          tone="light"
        />
      ) : null}
    </div>
  );
}
