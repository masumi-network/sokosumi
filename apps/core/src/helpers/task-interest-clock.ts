/** Used when a person has no Soko Bot to read a timezone from. */
export const TASK_INTEREST_FALLBACK_TIMEZONE = "Europe/Berlin";

/** Local hour on the first day after the due date when "overdue" is sent. */
export const OVERDUE_LOCAL_HOUR = 9;

const DAY_MS = 24 * 60 * 60 * 1_000;

function localParts(now: Date, timeZone: string) {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    // A stored zone this runtime does not know.
    return localParts(now, TASK_INTEREST_FALLBACK_TIMEZONE);
  }
  const parts = Object.fromEntries(
    format.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

/**
 * Whether the "overdue" moment for a Task due on `dueOn` (a `@db.Date`, UTC
 * midnight) is due now in `timeZone`: on the first local day after the due
 * date, from 09:00. A later day is not: a missed day sends nothing, so a
 * Task long overdue never sends an old alert.
 */
export function isOverdueMomentDue(
  dueOn: Date,
  now: Date,
  timeZone: string,
): boolean {
  const local = localParts(now, timeZone);
  const firstDayAfter = new Date(dueOn.getTime() + DAY_MS)
    .toISOString()
    .slice(0, 10);
  return local.day === firstDayAfter && local.hour >= OVERDUE_LOCAL_HOUR;
}
