import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";

export function getCalendarRange(dateParam: string) {
  const date = new Date(`${dateParam}T12:00:00`);
  // Pad the rendered month grid by a day on each side for client timezones.
  const from = addDays(startOfWeek(startOfMonth(date)), -1);
  const to = addDays(endOfWeek(endOfMonth(date)), 2);

  return { from, to };
}

export function getLatestCalendarDate(now: Date): Date {
  const horizon = addDays(now, 90);
  const candidate = startOfMonth(horizon);
  const candidateRange = getCalendarRange(format(candidate, "yyyy-MM-dd"));

  return candidateRange.to <= horizon ? candidate : subMonths(candidate, 1);
}

export function resolveCalendarDate(
  dateParam: string | undefined,
  now: Date,
): string {
  const parsedDate = dateParam ? new Date(`${dateParam}T12:00:00`) : now;
  const date = Number.isNaN(parsedDate.getTime()) ? now : parsedDate;
  const latestCalendarDate = getLatestCalendarDate(now);
  return format(
    date > latestCalendarDate ? latestCalendarDate : date,
    "yyyy-MM-dd",
  );
}
