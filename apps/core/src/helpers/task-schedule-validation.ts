import { TaskScheduleQuarantineReason, TaskStatus } from "@sokosumi/database";
import {
  isValidTimezone,
  parseTaskScheduleMetadata,
  type TaskScheduleMetadata,
} from "@sokosumi/utils";

import { computeScheduleNextRun } from "@/helpers/task-schedule";

export type PersistedTaskScheduleValidation =
  | { valid: true; metadata: TaskScheduleMetadata }
  | {
      valid: false;
      reason: TaskScheduleQuarantineReason;
      details: string;
    };

function getMetadataCursor(
  metadata: Extract<TaskScheduleMetadata, { version: 1; mode: "recurring" }>,
): Date {
  return new Date(metadata.lastRunAt ?? metadata.scheduledAt);
}

export function validatePersistedTaskSchedule(task: {
  metadata: string | null;
  nextRunAt: Date | null;
  status: TaskStatus;
}): PersistedTaskScheduleValidation {
  const metadata = parseTaskScheduleMetadata(task.metadata);
  if (!metadata) {
    return {
      valid: false,
      reason: TaskScheduleQuarantineReason.INVALID_METADATA,
      details: "Task schedule metadata failed schema validation",
    };
  }

  const timezone =
    metadata.version === 2 || metadata.mode === "recurring"
      ? metadata.timezone
      : null;
  if (timezone && !isValidTimezone(timezone)) {
    return {
      valid: false,
      reason: TaskScheduleQuarantineReason.INVALID_TIMEZONE,
      details: `Task schedule timezone is invalid: ${timezone}`,
    };
  }
  if (task.status !== TaskStatus.QUEUED) {
    return {
      valid: false,
      reason: TaskScheduleQuarantineReason.INVALID_STATUS,
      details: `Active schedule has invalid Task status: ${task.status}`,
    };
  }
  if (!task.nextRunAt) {
    return {
      valid: false,
      reason: TaskScheduleQuarantineReason.NEXT_RUN_MISMATCH,
      details: "Active schedule is missing nextRunAt",
    };
  }

  if (metadata.version === 1) {
    const expected =
      metadata.mode === "once"
        ? computeScheduleNextRun(metadata)
        : computeScheduleNextRun(metadata, getMetadataCursor(metadata));
    if (!expected || expected.getTime() !== task.nextRunAt.getTime()) {
      return {
        valid: false,
        reason: TaskScheduleQuarantineReason.NEXT_RUN_MISMATCH,
        details: `Expected nextRunAt ${expected?.toISOString() ?? "null"}, found ${task.nextRunAt.toISOString()}`,
      };
    }
  }

  return { valid: true, metadata };
}
