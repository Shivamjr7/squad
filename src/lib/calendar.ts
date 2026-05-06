// M25 — ICS + Google Calendar tap-out helpers. ICS is generated on the fly
// (no DB column), so the format here has to be self-contained and RFC-5545
// compliant enough for Apple Calendar + Google Calendar to import without
// fuss. Deliberately minimal: no VTIMEZONE block, no attendees, no alarms —
// the v1 plan is a single event, all-UTC timestamps.

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// YYYYMMDDTHHMMSSZ — UTC form per RFC 5545 §3.3.5 (DATE-TIME, form 2).
export function formatIcsDate(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

// RFC 5545 §3.3.11 — escape \, ;, , and newlines in TEXT values.
function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export type IcsInput = {
  uid: string;
  title: string;
  startsAt: Date;
  endsAt?: Date;
  location: string | null;
  description: string;
  url: string;
};

export function buildIcs(input: IcsInput): string {
  const start = formatIcsDate(input.startsAt);
  const end = formatIcsDate(
    input.endsAt ?? new Date(input.startsAt.getTime() + TWO_HOURS_MS),
  );
  const stamp = formatIcsDate(new Date());
  const lines: (string | null)[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Squad//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}@squad`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    `DESCRIPTION:${escapeIcsText(input.description)}`,
    input.location ? `LOCATION:${escapeIcsText(input.location)}` : null,
    `URL:${escapeIcsText(input.url)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.filter((l): l is string => l !== null).join("\r\n") + "\r\n";
}

export type GoogleCalendarInput = {
  title: string;
  startsAt: Date;
  endsAt?: Date;
  location: string | null;
  description: string;
};

export function buildGoogleCalendarUrl(input: GoogleCalendarInput): string {
  const start = formatIcsDate(input.startsAt);
  const end = formatIcsDate(
    input.endsAt ?? new Date(input.startsAt.getTime() + TWO_HOURS_MS),
  );
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${start}/${end}`,
    details: input.description,
  });
  if (input.location) params.set("location", input.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
