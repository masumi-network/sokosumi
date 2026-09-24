import { TaskScheduleEndsMode } from "@sokosumi/database";
import { isValidTimezone } from "@sokosumi/utils";

import { computeNextRun } from "@/helpers/cron";
import { badRequest, unprocessableEntity } from "@/helpers/error";

import type { TaskScheduleRule } from "@/schemas/task-schedule.schema";

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toLocalDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getLocalTimeParts(
  date: Date,
  timeZone: string,
): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
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

  return {
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
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

function zonedDateTimeLocalToUtc(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };

  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0,
    0,
  );

  let offset = getTimezoneOffsetMs(new Date(utcGuess), timeZone);
  let result = new Date(utcGuess - offset);
  offset = getTimezoneOffsetMs(result, timeZone);
  result = new Date(utcGuess - offset);

  return Number.isNaN(result.getTime()) ? null : result;
}

function calendarDaysBetween(
  earlier: Date,
  later: Date,
  timeZone: string,
): number {
  const earlierKey = toLocalDateKey(earlier, timeZone);
  const laterKey = toLocalDateKey(later, timeZone);
  const earlierMatch = LOCAL_DATE_PATTERN.exec(earlierKey);
  const laterMatch = LOCAL_DATE_PATTERN.exec(laterKey);
  if (!earlierMatch || !laterMatch) {
    return 0;
  }

  const earlierDate = new Date(
    Date.UTC(
      Number(earlierMatch[1]),
      Number(earlierMatch[2]) - 1,
      Number(earlierMatch[3]),
    ),
  );
  const laterDate = new Date(
    Date.UTC(
      Number(laterMatch[1]),
      Number(laterMatch[2]) - 1,
      Number(laterMatch[3]),
    ),
  );

  return Math.round(
    (laterDate.getTime() - earlierDate.getTime()) / (24 * 60 * 60 * 1000),
  );
}

function addCalendarDays(anchorAt: Date, days: number, timeZone: string): Date {
  const dateKey = toLocalDateKey(anchorAt, timeZone);
  const match = LOCAL_DATE_PATTERN.exec(dateKey);
  if (!match) {
    return anchorAt;
  }

  const shiftedDate = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  shiftedDate.setUTCDate(shiftedDate.getUTCDate() + days);

  const { hour, minute } = getLocalTimeParts(anchorAt, timeZone);
  const nextLocalIso = `${shiftedDate.getUTCFullYear()}-${pad2(shiftedDate.getUTCMonth() + 1)}-${pad2(shiftedDate.getUTCDate())}T${pad2(hour)}:${pad2(minute)}`;

  return zonedDateTimeLocalToUtc(nextLocalIso, timeZone) ?? anchorAt;
}

export function computeIntervalNextRun(
  anchorAt: Date,
  intervalDays: number,
  from: Date,
  timeZone = "UTC",
): Date {
  if (from < anchorAt) {
    return anchorAt;
  }

  const daysSinceAnchor = calendarDaysBetween(anchorAt, from, timeZone);
  // The calendar day of an interval can still be ahead of `from`. Step forward
  // only once that slot's local time has passed (or is exactly `from`).
  const periods = Math.floor(daysSinceAnchor / intervalDays);
  const candidate = addCalendarDays(anchorAt, periods * intervalDays, timeZone);
  if (candidate > from) {
    return candidate;
  }
  return addCalendarDays(anchorAt, (periods + 1) * intervalDays, timeZone);
}

/**
 * Rejects a Task Schedule rule that never produces a Run: an unknown
 * timezone, a cron expression with no next time, or an end on or before the
 * first Run.
 */
export function validateTaskScheduleRule(rule: TaskScheduleRule): void {
  if (!isValidTimezone(rule.timezone)) {
    throw badRequest("timezone is invalid");
  }

  let nextRun: Date | null;
  if (rule.intervalDays != null && rule.intervalDays > 1) {
    if (!rule.anchorAt) {
      throw badRequest(
        "anchorAt is required when intervalDays is greater than 1",
      );
    }

    const anchorAt = new Date(rule.anchorAt);
    if (Number.isNaN(anchorAt.getTime())) {
      throw badRequest("anchorAt must be a valid datetime");
    }

    nextRun = computeIntervalNextRun(
      anchorAt,
      rule.intervalDays,
      new Date(),
      rule.timezone,
    );
  } else {
    nextRun = computeNextRun({ cron: rule.expr, timezone: rule.timezone });
  }

  if (!nextRun) {
    throw badRequest("expr is not a valid cron expression for the timezone");
  }

  if (rule.endsMode === TaskScheduleEndsMode.ON && rule.endsOn) {
    const endsOn = new Date(rule.endsOn);
    if (endsOn <= new Date()) {
      throw unprocessableEntity("endsOn must be in the future");
    }

    if (endsOn <= nextRun) {
      throw unprocessableEntity("endsOn must be after the first scheduled Run");
    }
  }
}
