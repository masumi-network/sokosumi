"use server";

import { revalidatePath } from "next/cache";
import { taskService } from "@/lib/services/task.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

import type { TaskContextSelectionInput } from "./action";
import {
  normalizeOptionalProjectId,
  resolveAssigneeWrite,
  rethrowTaskActionError,
  revalidateTaskMutationRoutes,
  type TaskMutationActionResult,
  taskMutationFailure,
  taskMutationSuccess,
  toCoreTaskContext,
  toTaskMutationErrorKind,
} from "./task-mutation";

interface SetTaskAssigneeParameters extends AuthenticatedRequest {
  taskId: string;
  /** All three null unassigns the Task. */
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  assigneeUserId: string | null;
}

interface SetTaskProjectParameters extends AuthenticatedRequest {
  taskId: string;
  /** Null takes the Task out of its project. */
  projectId: string | null;
  /**
   * The Task's Context files for the new project. Core rebuilds the
   * description's project links only when `context` is sent.
   */
  context: TaskContextSelectionInput;
}

export const setTaskAssignee = withSession<
  SetTaskAssigneeParameters,
  TaskMutationActionResult<{ taskId: string }>
>(async ({ taskId, assigneeId, assigneeSokoBotId, assigneeUserId }) => {
  try {
    await taskService.patchTask(
      taskId,
      resolveAssigneeWrite(assigneeId, assigneeSokoBotId, assigneeUserId),
    );

    revalidateTaskMutationRoutes();
    return taskMutationSuccess({ taskId });
  } catch (error) {
    const mutationErrorKind = toTaskMutationErrorKind(error);
    if (mutationErrorKind) {
      return taskMutationFailure(mutationErrorKind);
    }
    rethrowTaskActionError(
      error,
      "Failed to update task assignee",
      "Failed to update task assignee",
    );
  }
});

export const setTaskProject = withSession<
  SetTaskProjectParameters,
  TaskMutationActionResult<{ taskId: string }>
>(async ({ taskId, projectId, context, session }) => {
  try {
    await taskService.patchTask(taskId, {
      projectId: normalizeOptionalProjectId(projectId) ?? null,
      context: toCoreTaskContext(context, session.user.id),
    });

    revalidateTaskMutationRoutes();
    revalidatePath("/projects");
    return taskMutationSuccess({ taskId });
  } catch (error) {
    const mutationErrorKind = toTaskMutationErrorKind(error);
    if (mutationErrorKind) {
      return taskMutationFailure(mutationErrorKind);
    }
    rethrowTaskActionError(
      error,
      "Failed to update task project",
      "Failed to update task project",
    );
  }
});
