import { Temporal } from "temporal-polyfill";

/** Issues that have, or had, a delivery time worth planning around. */
export const CALENDAR_ISSUE_STATUSES = [
  "SCHEDULED",
  "SENDING",
  "SENT",
] as const;

/** `YYYY-MM` from the URL, or the current month in the reader's time zone. */
export function resolveMonth(param: string | null, timeZone: string): string {
  if (param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param)) return param;
  return Temporal.Now.plainDateISO(timeZone).toPlainYearMonth().toString();
}

export function shiftMonth(month: string, months: number): string {
  return Temporal.PlainYearMonth.from(month).add({ months }).toString();
}

/** Whole Sunday-first weeks covering the month, as `YYYY-MM-DD` keys. */
export function getMonthGridDays(month: string): string[] {
  const first = Temporal.PlainYearMonth.from(month).toPlainDate({ day: 1 });
  const start = first.subtract({ days: first.dayOfWeek % 7 });
  const weeks = Math.ceil(((first.dayOfWeek % 7) + first.daysInMonth) / 7);
  return Array.from({ length: weeks * 7 }, (_, index) =>
    start.add({ days: index }).toString(),
  );
}

/** The grid's first midnight to the midnight after its last day, in `timeZone`. */
export function getMonthGridRange(month: string, timeZone: string) {
  const days = getMonthGridDays(month);
  const midnight = (day: Temporal.PlainDate) =>
    new Date(day.toZonedDateTime({ timeZone }).epochMilliseconds);
  return {
    from: midnight(Temporal.PlainDate.from(days[0]!)),
    to: midnight(Temporal.PlainDate.from(days.at(-1)!).add({ days: 1 })),
  };
}

export function dateKey(date: Date, timeZone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();
}
