"use server";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { err, ok, type Result } from "neverthrow";
import { revalidatePath } from "next/cache";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import type {
  TaskScheduleRule,
  TaskScheduleRuleReplacement,
  TaskVisibility,
} from "@/lib/clients/generated/core";
import {
  type TaskScheduleStateAction,
  taskScheduleService,
} from "@/lib/services/task-schedule.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

/**
 * `stale`: the schedule changed since the page read it (a newer revision or
 * state), so the caller reloads before trying again.
 */
export interface TaskScheduleActionError {
  kind: "stale" | "failed";
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

const STALE_KINDS: ReadonlySet<string> = new Set([
  CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT,
  CORE_API_ERROR_KINDS.SCHEDULE_STATE_CONFLICT,
  CORE_API_ERROR_KINDS.CONCURRENCY_CONFLICT,
]);

function toTaskScheduleActionError(error: unknown): TaskScheduleActionError {
  if (error instanceof CoreApiRequestError) {
    return {
      kind: error.kind && STALE_KINDS.has(error.kind) ? "stale" : "failed",
      message: error.message,
    };
  }
  return {
    kind: "failed",
    message: error instanceof Error ? error.message : "Request failed",
  };
}

function revalidateTaskSchedule(scheduleId: string): void {
  revalidatePath("/tasks");
  revalidatePath(`/tasks/schedules/${scheduleId}`);
}

async function runTaskScheduleAction<T>(
  operation: () => Promise<T>,
): Promise<TaskScheduleActionResult<T>> {
  let result: Result<T, TaskScheduleActionError>;
  try {
    result = ok(await operation());
  } catch (error) {
    result = err(toTaskScheduleActionError(error));
  }
  return toActionResult(result);
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
    revalidatePath("/tasks");
    return { scheduleId };
  }),
);
