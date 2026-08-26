import { TaskStatus } from "@sokosumi/database";
import {
  hasReachedTaskScheduleReleaseTarget,
  type TaskScheduleMetadata,
  type TaskScheduleMetadataV1,
} from "@sokosumi/utils";

import { computeNextRun } from "@/helpers/cron";
import { badRequest, unprocessableEntity } from "@/helpers/error";

import type { TaskScheduleInput } from "@/schemas/task-schedule.schema";

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const LEGACY_INTERVAL_DAYS_CRON_PATTERN = /^(\d+) (\d+) \*\/(\d+) \* \*$/;

const SCHEDULABLE_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.DRAFT,
  TaskStatus.READY,
  TaskStatus.QUEUED,
]);

export function isSchedulableTaskStatus(status: TaskStatus): boolean {
  return SCHEDULABLE_TASK_STATUSES.has(status);
}

export function inferLegacyIntervalDaysFromCron(expr: string): number | null {
  const match = LEGACY_INTERVAL_DAYS_CRON_PATTERN.exec(expr.trim());
  if (!match) {
    return null;
  }

  const intervalDays = Number(match[3]);
  return intervalDays > 1 ? intervalDays : null;
}

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
  const periods = Math.floor(daysSinceAnchor / intervalDays) + 1;
  return addCalendarDays(anchorAt, periods * intervalDays, timeZone);
}

function resolveRecurringIntervalDays(
  metadata: Extract<TaskScheduleMetadata, { mode: "recurring" }>,
): number | null {
  if (metadata.intervalDays != null && metadata.intervalDays > 1) {
    return metadata.intervalDays;
  }

  return inferLegacyIntervalDaysFromCron(metadata.expr);
}

function resolveRecurringAnchorAt(
  metadata: Extract<TaskScheduleMetadata, { mode: "recurring" }>,
): Date | null {
  if (metadata.anchorAt) {
    return new Date(metadata.anchorAt);
  }

  return metadata.version === 1 ? new Date(metadata.scheduledAt) : null;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function buildTaskScheduleMetadata(
  input: TaskScheduleInput,
  scheduledAt: Date,
): TaskScheduleMetadataV1 {
  const scheduledAtIso = scheduledAt.toISOString();

  if (input.mode === "once") {
    return {
      version: 1,
      mode: "once",
      scheduledAt: scheduledAtIso,
      runAt: input.runAt,
    };
  }

  return {
    version: 1,
    mode: "recurring",
    scheduledAt: scheduledAtIso,
    expr: input.expr,
    timezone: input.timezone ?? "UTC",
    endsMode: input.endsMode ?? "never",
    ...(input.endsOn ? { endsOn: input.endsOn } : {}),
    ...(input.occurrences != null ? { occurrences: input.occurrences } : {}),
    ...(input.intervalDays != null ? { intervalDays: input.intervalDays } : {}),
    ...(input.anchorAt ? { anchorAt: input.anchorAt } : {}),
  };
}

export function computeScheduleNextRun(
  metadata: TaskScheduleMetadata,
  from?: Date,
): Date | null {
  if (metadata.mode === "once") {
    return new Date(
      metadata.version === 1 ? metadata.runAt : metadata.effectiveRunAt,
    );
  }

  const intervalDays = resolveRecurringIntervalDays(metadata);
  if (intervalDays != null) {
    const anchorAt = resolveRecurringAnchorAt(metadata);
    if (!anchorAt || Number.isNaN(anchorAt.getTime())) {
      return null;
    }

    return computeIntervalNextRun(
      anchorAt,
      intervalDays,
      from ?? new Date(),
      metadata.timezone,
    );
  }

  return computeNextRun({
    cron: metadata.expr,
    timezone: metadata.timezone,
    from,
  });
}

export function validateScheduleInput(input: TaskScheduleInput): void {
  if (input.mode === "once") {
    const runAt = new Date(input.runAt);
    if (Number.isNaN(runAt.getTime())) {
      throw badRequest("runAt must be a valid datetime");
    }

    if (runAt <= new Date()) {
      throw unprocessableEntity("runAt must be in the future");
    }

    return;
  }

  const timezone = input.timezone ?? "UTC";
  if (!isValidTimezone(timezone)) {
    throw badRequest("timezone is invalid");
  }

  let nextRun: Date | null;
  if (input.intervalDays != null && input.intervalDays > 1) {
    if (!input.anchorAt) {
      throw badRequest(
        "anchorAt is required when intervalDays is greater than 1",
      );
    }

    const anchorAt = new Date(input.anchorAt);
    if (Number.isNaN(anchorAt.getTime())) {
      throw badRequest("anchorAt must be a valid datetime");
    }

    nextRun = computeIntervalNextRun(
      anchorAt,
      input.intervalDays,
      new Date(),
      timezone,
    );
  } else {
    nextRun = computeNextRun({
      cron: input.expr,
      timezone,
    });
  }

  if (!nextRun) {
    throw badRequest("expr is not a valid cron expression for the timezone");
  }

  if (input.endsMode === "on" && input.endsOn) {
    const endsOn = new Date(input.endsOn);
    if (endsOn <= new Date()) {
      throw unprocessableEntity("endsOn must be in the future");
    }

    if (endsOn <= nextRun) {
      throw unprocessableEntity(
        "endsOn must be after the first scheduled occurrence",
      );
    }
  }
}

export function isRecurringScheduleEnded(
  metadata: Extract<TaskScheduleMetadata, { mode: "recurring" }>,
  now: Date,
): boolean {
  if (metadata.endsMode === "on" && metadata.endsOn) {
    return now >= new Date(metadata.endsOn);
  }

  if (metadata.endsMode === "after") {
    return hasReachedTaskScheduleReleaseTarget(metadata);
  }

  return false;
}

export function isDueRunPastScheduleEnd(
  metadata: Extract<TaskScheduleMetadata, { mode: "recurring" }>,
  dueAt: Date,
): boolean {
  if (metadata.endsMode === "on" && metadata.endsOn) {
    return dueAt > new Date(metadata.endsOn);
  }

  if (metadata.endsMode === "after") {
    return hasReachedTaskScheduleReleaseTarget(metadata);
  }

  return false;
}
