export interface DateTimeLocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const DATE_TIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function parseDateTimeLocalParts(
  value: string | undefined,
): DateTimeLocalParts | null {
  const match = DATE_TIME_LOCAL_PATTERN.exec(value ?? "");
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  return { year, month, day, hour, minute };
}

function getTimezoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );

  return asUtc - date.getTime();
}

function zonedPartsToUtc(
  parts: DateTimeLocalParts & { second?: number; millisecond?: number },
  timeZone: string,
): Date | null {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second ?? 0,
    parts.millisecond ?? 0,
  );

  let offset = getTimezoneOffsetMs(new Date(utcGuess), timeZone);
  let result = new Date(utcGuess - offset);

  // Second pass handles DST boundaries where the offset shifts.
  offset = getTimezoneOffsetMs(result, timeZone);
  result = new Date(utcGuess - offset);

  return Number.isNaN(result.getTime()) ? null : result;
}

export function zonedDateTimeLocalToUtc(
  value: string | undefined,
  timeZone: string,
): Date | null {
  const parts = parseDateTimeLocalParts(value);
  if (!parts) return null;
  return zonedPartsToUtc(parts, timeZone);
}

export function utcToDateTimeLocalInTimezone(
  date: Date,
  timeZone: string,
): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return `${values.year}-${pad2(Number(values.month))}-${pad2(Number(values.day))}T${pad2(Number(values.hour))}:${pad2(Number(values.minute))}`;
}

function addOneLocalDate(dateStr: string): string | null {
  const match = LOCAL_DATE_PATTERN.exec(dateStr);
  if (!match) return null;

  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  date.setUTCDate(date.getUTCDate() + 1);

  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function endOfLocalDateInTimezone(
  dateStr: string,
  timeZone: string,
): Date | null {
  const nextDay = addOneLocalDate(dateStr);
  if (!nextDay) return null;

  const startOfNextDay = zonedDateTimeLocalToUtc(`${nextDay}T00:00`, timeZone);
  if (!startOfNextDay) return null;

  return new Date(startOfNextDay.getTime() - 1);
}
