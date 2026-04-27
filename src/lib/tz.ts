// Convert a "naive" wall-clock string from <input type="datetime-local">
// (no offset, e.g. "2026-05-02T20:00") into a real UTC Date, given the IANA
// time zone the user was in when they typed it (e.g. "Asia/Kolkata").
//
// Recipe (Intl-only, no deps):
//   1. Pretend the wall clock IS UTC → fakeUtc.
//   2. Render that fake UTC moment in BOTH the target zone and UTC, then
//      subtract: the diff is the zone's offset at that wall clock.
//      Both renders go through the server's local TZ via new Date(string),
//      so that effect cancels — only the difference survives.
//   3. Subtract the offset from fakeUtc → the real UTC moment whose wall
//      clock in `timeZone` reads exactly what the user typed.
//
// DST is handled correctly because Intl knows DST rules per zone.
// Spring-forward (non-existent hour) collapses to one moment; fall-back
// (duplicated hour) resolves to one of the two — both acceptable for v1.
export function zonedWallClockToUtc(
  localISO: string,
  timeZone: string,
): Date {
  // localISO may be "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss".
  const withSeconds = /:\d{2}:\d{2}$/.test(localISO)
    ? localISO
    : `${localISO}:00`;
  const fakeUtc = new Date(`${withSeconds}Z`);
  if (Number.isNaN(fakeUtc.getTime())) {
    throw new Error(`Invalid datetime-local value: ${localISO}`);
  }

  const inZone = new Date(
    fakeUtc.toLocaleString("en-US", { timeZone }),
  );
  const inUtc = new Date(
    fakeUtc.toLocaleString("en-US", { timeZone: "UTC" }),
  );
  const offsetMs = inZone.getTime() - inUtc.getTime();

  return new Date(fakeUtc.getTime() - offsetMs);
}

// Read the IANA zone the browser is in. Safe for client-side use.
export function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Loose IANA-zone validity check. We don't ship a zone database, so the cheap
// check is: ask Intl to format with the proposed zone and see if it throws.
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
