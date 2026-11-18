"use server";

import { type Task, TaskStatus } from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { taskService } from "@/lib/services/task.service";
import { normalizeTaskNameForCoreApi } from "@/lib/utils/task-transformer";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface CreateSubtaskParameters extends AuthenticatedRequest {
  parentTaskId: string;
  name: string;
}

/** Adds a Ready sub-task, last in its parent's checklist. */
export const createSubtask = withSession<
  CreateSubtaskParameters,
  ActionResultDto<Task, ActionError>
>(async ({ parentTaskId, name }) => {
  try {
    const task = await taskService.createTask({
      name: normalizeTaskNameForCoreApi(name),
      description: null,
      assigneeId: null,
      status: TaskStatus.READY,
      parentTaskId,
    });
    // The parent's card on the board counts its sub-tasks.
    revalidatePath("/tasks");
    return toActionResult(ok(task));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface MoveSubtaskParameters extends AuthenticatedRequest {
  taskId: string;
  /** The sibling it goes right after; null makes it first. */
  afterTaskId: string | null;
}

/** Reorders a sub-task. Only the checklist reads the order. */
export const moveSubtask = withSession<
  MoveSubtaskParameters,
  ActionResultDto<{ taskId: string }, ActionError>
>(async ({ taskId, afterTaskId }) => {
  try {
    await taskService.moveSubtask(taskId, afterTaskId);
    return toActionResult(ok({ taskId }));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});
