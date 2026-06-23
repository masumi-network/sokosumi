import {
  type TaskScheduleMetadata,
  taskScheduleMetadataSchema,
} from "@sokosumi/database/types/task-schedule-metadata";

import { computeNextRun } from "@/helpers/cron";
import { badRequest, unprocessableEntity } from "@/helpers/error";

import type { PutTaskScheduleRequest } from "@/schemas/task-schedule.schema";

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
  };
}

export function computeScheduleNextRun(
  metadata: TaskScheduleMetadata,
  from?: Date,
): Date | null {
  if (metadata.mode === "once") {
    return new Date(metadata.runAt);
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

  const nextRun = computeNextRun({
    cron: input.expr,
    timezone,
  });
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
