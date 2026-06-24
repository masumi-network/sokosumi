import {
  type TaskScheduleMetadata,
  taskScheduleMetadataSchema,
} from "@sokosumi/database/types/task-schedule-metadata";

import { computeNextRun } from "@/helpers/cron";
import { badRequest, unprocessableEntity } from "@/helpers/error";

import type { PutTaskScheduleRequest } from "@/schemas/task-schedule.schema";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const LEGACY_INTERVAL_DAYS_CRON_PATTERN = /^(\d+) (\d+) \*\/(\d+) \* \*$/;

export function inferLegacyIntervalDaysFromCron(expr: string): number | null {
  const match = LEGACY_INTERVAL_DAYS_CRON_PATTERN.exec(expr.trim());
  if (!match) {
    return null;
  }

  const intervalDays = Number(match[3]);
  return intervalDays > 1 ? intervalDays : null;
}

export function computeIntervalNextRun(
  anchorAt: Date,
  intervalDays: number,
  from: Date,
): Date {
  if (from < anchorAt) {
    return anchorAt;
  }

  const elapsedMs = from.getTime() - anchorAt.getTime();
  const periods = Math.floor(elapsedMs / (intervalDays * MS_PER_DAY)) + 1;
  return new Date(anchorAt.getTime() + periods * intervalDays * MS_PER_DAY);
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

  return new Date(metadata.scheduledAt);
}

export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function parseTaskScheduleMetadata(
  metadata: string | null | undefined,
): TaskScheduleMetadata | null {
  if (!metadata) {
    return null;
  }

  try {
    const parsed = taskScheduleMetadataSchema.safeParse(JSON.parse(metadata));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function buildTaskScheduleMetadata(
  input: PutTaskScheduleRequest,
  scheduledAt: Date,
): TaskScheduleMetadata {
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
    return new Date(metadata.runAt);
  }

  const intervalDays = resolveRecurringIntervalDays(metadata);
  if (intervalDays != null) {
    const anchorAt = resolveRecurringAnchorAt(metadata);
    if (!anchorAt || Number.isNaN(anchorAt.getTime())) {
      return null;
    }

    return computeIntervalNextRun(anchorAt, intervalDays, from ?? new Date());
  }

  return computeNextRun({
    cron: metadata.expr,
    timezone: metadata.timezone,
    from,
  });
}

export function validateScheduleInput(input: PutTaskScheduleRequest): void {
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

    nextRun = computeIntervalNextRun(anchorAt, input.intervalDays, new Date());
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
    return metadata.occurrences != null && metadata.occurrences <= 0;
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
    return metadata.occurrences != null && metadata.occurrences <= 0;
  }

  return false;
}
