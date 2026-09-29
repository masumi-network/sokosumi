"use server";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { ResultAsync } from "neverthrow";
import { revalidatePath } from "next/cache";

import {
  TASK_SCHEDULES_PATH,
  taskSchedulePath,
} from "@/app/tasks/utils/task-schedule-view";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import type { TaskScheduleStateAction } from "@/lib/clients/core.shared";
import type {
  TaskScheduleRule,
  TaskScheduleRuleReplacement,
  TaskVisibility,
  UpdateTaskScheduleRunRequest,
} from "@/lib/clients/generated/core";
import { taskScheduleService } from "@/lib/services/task-schedule.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

/**
 * `stale`: the schedule or Run changed since the page read it (a newer
 * revision or state), so the caller reloads before trying again.
 * `invalid_time`: a Run cannot move to that time (past, or beyond the
 * projection horizon).
 */
export interface TaskScheduleActionError {
  kind: "stale" | "invalid_time" | "failed";
  message: string;
}

type TaskScheduleActionResult<T> = ActionResultDto<T, TaskScheduleActionError>;

/** The Task each Run creates. */
export interface TaskScheduleBlueprintInput {
  name: string;
  description: string | null;
  projectId: string | null;
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  assigneeUserId: string | null;
}

interface CreateTaskScheduleParameters
  extends AuthenticatedRequest,
    TaskScheduleBlueprintInput {
  visibility: TaskVisibility;
  rule: TaskScheduleRule;
}

interface UpdateTaskScheduleParameters
  extends AuthenticatedRequest,
    TaskScheduleBlueprintInput {
  scheduleId: string;
  expectedRevision: number;
  /** Omitted when unchanged: a new rule cancels skipped and moved Runs. */
  rule?: TaskScheduleRuleReplacement;
}

interface ChangeTaskScheduleStateParameters extends AuthenticatedRequest {
  scheduleId: string;
  action: TaskScheduleStateAction;
}

interface DeleteTaskScheduleParameters extends AuthenticatedRequest {
  scheduleId: string;
}

type ChangeTaskScheduleRunParameters = AuthenticatedRequest &
  UpdateTaskScheduleRunRequest & { scheduleId: string; runId: string };

const STALE_KINDS: ReadonlySet<string> = new Set([
  CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT,
  CORE_API_ERROR_KINDS.SCHEDULE_STATE_CONFLICT,
  CORE_API_ERROR_KINDS.CONCURRENCY_CONFLICT,
  CORE_API_ERROR_KINDS.SCHEDULE_RUN_STATE_CONFLICT,
]);

function toTaskScheduleActionError(error: unknown): TaskScheduleActionError {
  if (error instanceof CoreApiRequestError) {
    return {
      kind:
        error.kind === CORE_API_ERROR_KINDS.SCHEDULE_RUN_TARGET_INVALID
          ? "invalid_time"
          : error.kind && STALE_KINDS.has(error.kind)
            ? "stale"
            : "failed",
      message: error.message,
    };
  }
  return {
    kind: "failed",
    message: error instanceof Error ? error.message : "Request failed",
  };
}

function revalidateTaskSchedule(scheduleId: string): void {
  revalidatePath(TASK_SCHEDULES_PATH);
  revalidatePath(taskSchedulePath(scheduleId));
}

async function runTaskScheduleAction<T>(
  operation: () => Promise<T>,
): Promise<TaskScheduleActionResult<T>> {
  return toActionResult(
    await ResultAsync.fromPromise(operation(), toTaskScheduleActionError),
  );
}

export const createTaskSchedule = withSession<
  CreateTaskScheduleParameters,
  TaskScheduleActionResult<{ scheduleId: string }>
>(async ({ session: _session, ...input }) =>
  runTaskScheduleAction(async () => {
    const schedule = await taskScheduleService.createSchedule(input);
    revalidateTaskSchedule(schedule.id);
    return { scheduleId: schedule.id };
  }),
);

/** Replaces the blueprint and the rule; Runs already released stay as they are. */
export const updateTaskSchedule = withSession<
  UpdateTaskScheduleParameters,
  TaskScheduleActionResult<{ scheduleId: string }>
>(async ({ session: _session, scheduleId, ...input }) =>
  runTaskScheduleAction(async () => {
    await taskScheduleService.updateSchedule(scheduleId, input);
    revalidateTaskSchedule(scheduleId);
    return { scheduleId };
  }),
);

export const changeTaskScheduleState = withSession<
  ChangeTaskScheduleStateParameters,
  TaskScheduleActionResult<{ scheduleId: string }>
>(async ({ scheduleId, action }) =>
  runTaskScheduleAction(async () => {
    await taskScheduleService.changeScheduleState(scheduleId, action);
    revalidateTaskSchedule(scheduleId);
    return { scheduleId };
  }),
);

/** Tasks the schedule created stay; they just stop pointing to it. */
export const deleteTaskSchedule = withSession<
  DeleteTaskScheduleParameters,
  TaskScheduleActionResult<{ scheduleId: string }>
>(async ({ scheduleId }) =>
  runTaskScheduleAction(async () => {
    await taskScheduleService.deleteSchedule(scheduleId);
    revalidatePath(TASK_SCHEDULES_PATH);
    return { scheduleId };
  }),
);

/** Skips, moves, or restores one upcoming Run; the rule stays as it is. */
export const changeTaskScheduleRun = withSession<
  ChangeTaskScheduleRunParameters,
  TaskScheduleActionResult<{ scheduleId: string; runId: string }>
>(async ({ session: _session, scheduleId, runId, ...change }) =>
  runTaskScheduleAction(async () => {
    await taskScheduleService.changeRun(scheduleId, runId, change);
    revalidateTaskSchedule(scheduleId);
    return { scheduleId, runId };
  }),
);
