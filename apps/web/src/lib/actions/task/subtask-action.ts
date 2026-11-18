"use server";

import { type Task, TaskStatus } from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
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
import {
  resolveAssigneeWrite,
  revalidateTaskMutationRoutes,
} from "./task-mutation";

interface CreateSubtaskParameters extends AuthenticatedRequest {
  parentTaskId: string;
  name: string;
  assigneeId?: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  /** `YYYY-MM-DD`. */
  dueOn?: string | null;
}

/** Adds a Ready sub-task, last in its parent's checklist. */
export const createSubtask = withSession<
  CreateSubtaskParameters,
  ActionResultDto<Task, ActionError>
>(
  async ({
    parentTaskId,
    name,
    assigneeId,
    assigneeSokoBotId,
    assigneeUserId,
    dueOn,
  }) => {
    try {
      const task = await taskService.createTask({
        name: normalizeTaskNameForCoreApi(name),
        description: null,
        ...resolveAssigneeWrite(assigneeId, assigneeSokoBotId, assigneeUserId),
        status: TaskStatus.READY,
        parentTaskId,
        ...(dueOn ? { dueOn } : {}),
      });
      // The parent's page renders the checklist only once it has a sub-task,
      // and the parent's card on the board counts its sub-tasks.
      revalidateTaskMutationRoutes();
      return toActionResult(ok(task));
    } catch (error) {
      return toActionResult(err(toCoreApiActionError(error)));
    }
  },
);

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
    await taskService.moveSubtask(taskId, { afterTaskId });
    return toActionResult(ok({ taskId }));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

interface SetTaskParentParameters extends AuthenticatedRequest {
  taskId: string;
  /** The Task it goes under, last among its sub-tasks; null detaches it. */
  parentTaskId: string | null;
}

/** Attaches, re-parents or detaches a Task, with its own sub-tasks. */
export const setTaskParent = withSession<
  SetTaskParentParameters,
  ActionResultDto<{ taskId: string }, ActionError>
>(async ({ taskId, parentTaskId }) => {
  try {
    await taskService.moveSubtask(taskId, { parentTaskId });
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
  // The old and the new parent pages, the Task's own page, and the board,
  // which shows root Tasks only.
  revalidateTaskMutationRoutes();
  return toActionResult(ok({ taskId }));
});
