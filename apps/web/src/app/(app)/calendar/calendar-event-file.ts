/** One Calendar entry as an iCalendar (RFC 5545) file another calendar app imports. */
export interface CalendarEventFileInput {
  /** Stable across downloads, so importing again updates the event instead of adding one. */
  uid: string;
  title: string;
  start: Date;
  /** Where the entry lives in Sokosumi. */
  url: string;
  /** When the file is made; DTSTAMP. */
  now: Date;
}

function utcStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets continue on the next line after a space. */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let limit = 75;
  for (const char of line) {
    if (encoder.encode(current + char).length > limit) {
      parts.push(current);
      current = "";
      limit = 74;
    }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/**
 * A single event at `start`. It has no end: Sokosumi knows when work starts,
 * not how long it takes, so the file does not invent a duration.
 */
export function calendarEventFile({
  uid,
  title,
  start,
  url,
  now,
}: CalendarEventFileInput): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sokosumi//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeText(uid)}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(start)}`,
    `SUMMARY:${escapeText(title)}`,
    `DESCRIPTION:${escapeText(url)}`,
    `URL:${url}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(foldLine)
    .join("\r\n");
}

/** A safe file name from the entry's title. */
export function calendarEventFileName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60)
    .toLowerCase();
  return `${slug || "event"}.ics`;
}
