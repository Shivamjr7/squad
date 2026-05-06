import { VoteSpectrumBar } from "@/components/votes/vote-spectrum-bar";

const SHORT_TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const SHORT_DAY = new Intl.DateTimeFormat(undefined, { weekday: "short" });

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayDescriptor(startsAt: Date, now: Date): string {
  if (isSameLocalDay(startsAt, now)) {
    const h = startsAt.getHours();
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
  isApproximate: boolean;
  location: string | null;
  showVenueVote: boolean; // when multi-venue voting is open, defer to that
  now: Date;
};

// M24 — Variant A wrapper for the Current Plan card. Same content as the
// pre-M24 inline render; extracted so the page can pick a variant per
// PlanVariant. Adds the slim spectrum bar above the title row to mirror the
// reference mock's color hint at the top of the card.
export function DecisionCard({
  planId,
  startsAt,
  isApproximate,
  location,
  showVenueVote,
  now,
}: Props) {
  let bigTime = "";
  let smallTime = "";
  if (isApproximate) {
    bigTime = SHORT_TIME.format(startsAt);
  } else {
    const parts = SHORT_TIME.formatToParts(startsAt);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "";
    const ampm =
      parts.find((p) => p.type === "dayPeriod")?.value?.toUpperCase() ?? "";
    bigTime = `${hour}:${minute}`;
    smallTime = `${ampm} ${dayDescriptor(startsAt, now)}`;
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-paper-card p-5 shadow-[0_1px_2px_rgba(20,15,10,0.04),0_8px_24px_-12px_rgba(20,15,10,0.10)]">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
        Current plan
      </span>
      <div className="flex items-baseline gap-2">
        <span className="font-serif text-5xl font-semibold leading-none text-ink">
          {bigTime}
        </span>
        {smallTime ? (
          <span className="text-sm text-ink-muted">{smallTime}</span>
        ) : null}
      </div>
      {showVenueVote ? (
        <p className="text-base text-ink-muted">Voting on venue ↓</p>
      ) : location ? (
        <p className="text-base text-ink">
          {location}{" "}
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(location)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-coral underline-offset-2 hover:underline"
          >
            map
          </a>
        </p>
      ) : (
        <p className="text-base text-ink-muted">Location TBD</p>
      )}
      <VoteSpectrumBar planId={planId} tone="light" />
    </section>
  );
}
