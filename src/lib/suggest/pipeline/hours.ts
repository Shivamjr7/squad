// Opening-hours math used by both filter.ts and score.ts. Kept tiny and
// timezone-naive on purpose — for v1, we treat the time window and the
// venue's hours as living in the same wall-clock frame (Activity providers
// stamp OpeningHours.timeZone but we don't yet apply a shift). The error
// term is bounded by the window's TZ offset, which is fine for the friend-
// group scope. Real TZ conversion is a v2 concern.

import type { OpeningHours, TimeWindow } from "@/lib/suggest/types";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function windowDurationMinutes(tw: TimeWindow): number {
  const start = new Date(tw.startsAtUtc).getTime();
  const end = new Date(tw.endsAtUtc).getTime();
  return Math.max(0, Math.floor((end - start) / 60_000));
}

/**
 * Total minutes during the window that the venue is open. Sums across each
 * day the window touches (most windows are intra-day; multi-day plans hit
 * the rare path).
 */
export function hoursOverlapMinutes(
  hours: OpeningHours,
  tw: TimeWindow,
): number {
  const start = new Date(tw.startsAtUtc).getTime();
  const end = new Date(tw.endsAtUtc).getTime();
  if (end <= start) return 0;

  let total = 0;
  // Walk one day at a time so a window straddling midnight gets credit on
  // both sides. Capped at 7 days defensively.
  let cursor = start;
  let safety = 0;
  while (cursor < end && safety < 7) {
    const cursorDate = new Date(cursor);
    const isoDay = ((cursorDate.getUTCDay() + 6) % 7) + 1; // Sun=0..Sat=6 → Mon=1..Sun=7
    const brackets = hours.weekly[isoDay];
    if (brackets && brackets.length) {
      const dayStart = new Date(cursorDate);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayStartMs = dayStart.getTime();
      const dayEndMs = dayStartMs + ONE_DAY_MS;
      for (const { open, close } of brackets) {
        const openMs = dayStartMs + hmToMinutes(open) * 60_000;
        const closeMs = dayStartMs + hmToMinutes(close) * 60_000;
        const a = Math.max(openMs, cursor);
        const b = Math.min(closeMs, end, dayEndMs);
        if (b > a) total += Math.floor((b - a) / 60_000);
      }
    }
    // Advance cursor to start-of-next-day in UTC.
    const next = new Date(cursorDate);
    next.setUTCHours(24, 0, 0, 0);
    cursor = next.getTime();
    safety += 1;
  }
  return total;
}

function hmToMinutes(hm: string): number {
  const idx = hm.indexOf(":");
  if (idx < 0) return 0;
  const h = Number.parseInt(hm.slice(0, idx), 10);
  const m = Number.parseInt(hm.slice(idx + 1), 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}
