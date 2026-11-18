"use server";

import {
  type Task,
  type TaskEvent,
  type TaskPriority,
  TaskStatus,
  type UserWritableTaskLinkRelation,
} from "@sokosumi/core-client";
import {
  taskContextSelectionAttachesAnything,
  userTaskStatusTransitionRequiresComment,
} from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import {
  CoreApiRequestError,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import { taskService } from "@/lib/services/task.service";
import {
  TASK_MUTATION_ERROR_KINDS,
  type TaskMutationErrorKind,
} from "@/lib/utils/task-mutation-error-kinds";
import { normalizeTaskNameForCoreApi } from "@/lib/utils/task-transformer";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

import {
  archiveCreatedTaskAfterFailure,
  collectParentLinksToReplace,
  deletePreviousParentLinks,
} from "./task-link-replacement";
import {
  createTaskFromDescription,
  normalizeOptionalProjectId,
  resolveAssigneeWrite,
  type TaskContextSelectionInput,
  type TaskTagSnapshot,
  type TaskTagWrite,
  taskTagSnapshot,
  toCoreTaskContext,
} from "./task-write-input";

export type { TaskContextSelectionInput } from "./task-write-input";

interface CreateTaskParameters extends AuthenticatedRequest, TaskTagWrite {
  tagSuggestionReceipt?: string;
  /** A copy takes this Task's tags in Core instead of being classified. */
  copyOfTaskId?: string;
  name?: string;
  description: string;
  assigneeId: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  projectId?: string | null;
  context?: TaskContextSelectionInput;
  status: Extract<TaskStatus, "DRAFT" | "READY" | "QUEUED">;
  /** ISO time to start the Task at; Core then creates it Queued. */
  runAt?: string;
  visibility?: "PUBLIC" | "PRIVATE";
}

interface UpdateTaskParameters extends AuthenticatedRequest, TaskTagWrite {
  expectedWorkspaceTagIds?: string[];
  taskId: string;
  name: string;
  description: string;
  assigneeId: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  projectId?: string | null;
  context?: TaskContextSelectionInput;
  desiredStatus: TaskStatus;
  /** New ISO Run at, or null to clear it before changing assignee. */
  runAt?: string | null;
}

interface TaskMutationError {
  kind: TaskMutationErrorKind;
}

type TaskMutationActionResult<T> = ActionResultDto<T, TaskMutationError>;

export type CreateTaskResult = TaskMutationActionResult<{
  taskId: string;
  name: string;
  identifier: string | null;
}>;
type UpdateTaskResult = TaskMutationActionResult<{ taskId: string }>;
type SetTaskStatusResult = TaskMutationActionResult<{ taskId: string }>;
type CreateTaskAndLinkResult = TaskMutationActionResult<{
  taskId: string;
  createdTaskId: string;
  linkId: string;
  name: string;
  identifier: string | null;
}>;

function taskMutationSuccess<T>(value: T): TaskMutationActionResult<T> {
  return toActionResult(ok(value));
}

function taskMutationFailure<T>(
  kind: TaskMutationErrorKind,
): TaskMutationActionResult<T> {
  return toActionResult(err({ kind }));
}

function toTaskMutationErrorKind(error: unknown): TaskMutationErrorKind | null {
  if (!(error instanceof CoreApiRequestError)) {
    return null;
  }

  return TASK_MUTATION_ERROR_KINDS.find((kind) => kind === error.kind) ?? null;
}

interface SetTaskStatusFromDragParameters extends AuthenticatedRequest {
  taskId: string;
  desiredStatus: TaskStatus;
  /** Required by Core when reopening CANCELED/COMPLETED → READY (SOK-631). */
  comment?: string;
}

interface SetTaskPriorityParameters extends AuthenticatedRequest {
  taskId: string;
  priority: TaskPriority;
}

interface SetTaskDueOnParameters extends AuthenticatedRequest {
  taskId: string;
  /** `YYYY-MM-DD`, or null to clear. */
  dueOn: string | null;
}

interface MoveTaskToWorkspaceParameters extends AuthenticatedRequest {
  taskId: string;
  organizationId: string | null;
}

interface CreateTaskCommentParameters extends AuthenticatedRequest {
  taskId: string;
  comment: string;
  /** Workspace members @-mentioned in the comment; Core adds them as Task participants. */
  mentionedUserIds?: string[];
}

interface RemoveTaskParticipantParameters extends AuthenticatedRequest {
  taskId: string;
}

interface SubscribeTaskParticipantParameters extends AuthenticatedRequest {
  taskId: string;
}

interface CreateTaskLinkParameters extends AuthenticatedRequest {
  taskId: string;
  relatedTaskId: string;
  relation: UserWritableTaskLinkRelation;
  note?: string | null;
  replaceExistingParent?: boolean;
}

interface DeleteTaskLinkParameters extends AuthenticatedRequest {
  taskId: string;
  linkId: string;
}

interface CreateAndLinkTaskParameters
  extends AuthenticatedRequest,
    TaskTagWrite {
  name?: string;
  tagSuggestionReceipt?: string;
  taskId: string;
  description: string;
  assigneeId: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  projectId?: string | null;
  context?: TaskContextSelectionInput;
  status: Extract<TaskStatus, "DRAFT" | "READY" | "QUEUED">;
  runAt?: string;
  visibility?: "PUBLIC" | "PRIVATE";
  relation: UserWritableTaskLinkRelation;
  note?: string | null;
  replaceExistingParent?: boolean;
}

function isClientCoreApiError(error: unknown): error is CoreApiRequestError {
  return (
    error instanceof CoreApiRequestError &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 401
  );
}

function rethrowTaskActionError(
  error: unknown,
  fallbackMessage: string,
  logLabel: string,
): never {
  console.error(logLabel, error);

  if (isClientCoreApiError(error)) {
    throw error;
  }

  const { message } = toCoreApiActionError(error);
  throw new Error(message ?? fallbackMessage);
}

function normalizeLinkNote(note?: string | null): string | null | undefined {
  if (typeof note === "undefined") {
    return undefined;
  }

  const trimmedNote = note?.trim();
  return trimmedNote ? trimmedNote : null;
}

/**
 * A task page can be open at `/tasks/{uuid}`, `/tasks/SOK-12` or the slug URL,
 * so revalidate the route, not one concrete path.
 */
function revalidateTaskMutationRoutes() {
  revalidatePath("/tasks");
  revalidatePath("/tasks/[taskId]", "page");
}

export const createTask = withSession<CreateTaskParameters, CreateTaskResult>(
  async ({
    name,
    tagSuggestionReceipt,
    workspaceTagIds,
    dismissedTopicIds,
    dismissedWorkspaceTagIds,
    copyOfTaskId,
    description,
    assigneeId,
    assigneeSokoBotId,
    assigneeUserId,
    projectId,
    session,
    context,
    status,
    runAt,
    visibility,
  }) => {
    try {
      const task = await createTaskFromDescription({
        ...(name ? { name } : {}),
        description,
        tagSuggestionReceipt,
        workspaceTagIds,
        dismissedTopicIds,
        dismissedWorkspaceTagIds,
        copyOfTaskId,
        assigneeId,
        assigneeSokoBotId,
        assigneeUserId,
        projectId,
        userId: session.user.id,
        context,
        status,
        runAt,
        visibility,
      });

      revalidatePath("/tasks");
      revalidatePath("/projects");
      return taskMutationSuccess({
        taskId: task.id,
        name: task.name,
        identifier: task.identifier,
      });
    } catch (error) {
      const mutationErrorKind = toTaskMutationErrorKind(error);
      if (mutationErrorKind) {
        return taskMutationFailure(mutationErrorKind);
      }
      rethrowTaskActionError(
        error,
        "Failed to create task",
        "Failed to create task",
      );
    }
  },
);

export const updateTask = withSession<UpdateTaskParameters, UpdateTaskResult>(
  async ({
    taskId,
    name,
    description,
    assigneeId,
    assigneeSokoBotId,
    assigneeUserId,
    projectId,
    context,
    desiredStatus,
    expectedWorkspaceTagIds,
    workspaceTagIds,
    dismissedTopicIds,
    dismissedWorkspaceTagIds,
    runAt,
    session,
  }) => {
    const trimmedDescription = description.trim();
    const trimmedName = normalizeTaskNameForCoreApi(name);
    // Edit may strip Context links into an empty body; Core re-prepends from
    // `context`. Reject only when both the body and every Context chip are off.
    if (
      !trimmedDescription &&
      !(context && taskContextSelectionAttachesAnything(context))
    ) {
      throw new Error("Description required");
    }
    if (!trimmedName) {
      throw new Error("Name required");
    }

    try {
      const normalizedProjectId = normalizeOptionalProjectId(projectId);

      // A new Run at queues the Task inside the patch, so the status the
      // patch returns is the one a following event must move away from.
      const patchedTask = await taskService.patchTask(taskId, {
        name: trimmedName,
        description: trimmedDescription,
        ...(workspaceTagIds !== undefined
          ? { workspaceTagIds, expectedWorkspaceTagIds }
          : {}),
        ...(dismissedTopicIds !== undefined ? { dismissedTopicIds } : {}),
        ...(dismissedWorkspaceTagIds !== undefined
          ? { dismissedWorkspaceTagIds }
          : {}),
        ...resolveAssigneeWrite(assigneeId, assigneeSokoBotId, assigneeUserId),
        ...(typeof normalizedProjectId !== "undefined"
          ? { projectId: normalizedProjectId }
          : {}),
        ...(context
          ? { context: toCoreTaskContext(context, session.user.id) }
          : {}),
        ...(runAt !== undefined
          ? { runAt: runAt === null ? null : new Date(runAt) }
          : {}),
      });

      if (desiredStatus !== patchedTask.status) {
        await taskService.createTaskEvent(taskId, {
          status: desiredStatus,
        });
      }

      revalidateTaskMutationRoutes();
      if (typeof normalizedProjectId !== "undefined") {
        revalidatePath("/projects");
      }
      return taskMutationSuccess({ taskId });
    } catch (error) {
      const mutationErrorKind = toTaskMutationErrorKind(error);
      if (mutationErrorKind) {
        return taskMutationFailure(mutationErrorKind);
      }
      rethrowTaskActionError(
        error,
        "Failed to update task",
        "Failed to update task",
      );
    }
  },
);

export const setTaskStatusFromDrag = withSession<
  SetTaskStatusFromDragParameters,
  SetTaskStatusResult
>(async ({ taskId, desiredStatus, comment }) => {
  try {
    const task = await taskService.getTaskById(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    const currentStatus = task.status as TaskStatus;

    if (desiredStatus !== currentStatus) {
      const trimmedComment = comment?.trim();
      if (
        userTaskStatusTransitionRequiresComment(currentStatus, desiredStatus) &&
        !trimmedComment
      ) {
        throw new Error(
          "A comment is required when reopening a canceled or completed task to ready",
        );
      }

      await taskService.createTaskEvent(taskId, {
        status: desiredStatus,
        ...(trimmedComment ? { comment: trimmedComment } : {}),
      });
    }

    revalidateTaskMutationRoutes();
    return taskMutationSuccess({ taskId });
  } catch (error) {
    const mutationErrorKind = toTaskMutationErrorKind(error);
    if (mutationErrorKind) {
      return taskMutationFailure(mutationErrorKind);
    }
    rethrowTaskActionError(
      error,
      "Failed to update task status",
      "Failed to update task status",
    );
  }
});

export const setTaskPriority = withSession<
  SetTaskPriorityParameters,
  TaskMutationActionResult<{ taskId: string }>
>(async ({ taskId, priority }) => {
  try {
    await taskService.patchTask(taskId, { priority });

    revalidateTaskMutationRoutes();
    return taskMutationSuccess({ taskId });
  } catch (error) {
    const mutationErrorKind = toTaskMutationErrorKind(error);
    if (mutationErrorKind) {
      return taskMutationFailure(mutationErrorKind);
    }
    rethrowTaskActionError(
      error,
      "Failed to update task priority",
      "Failed to update task priority",
    );
  }
});

export const setTaskDueOn = withSession<
  SetTaskDueOnParameters,
  TaskMutationActionResult<{ taskId: string }>
>(async ({ taskId, dueOn }) => {
  try {
    await taskService.patchTask(taskId, { dueOn });

    revalidateTaskMutationRoutes();
    return taskMutationSuccess({ taskId });
  } catch (error) {
    const mutationErrorKind = toTaskMutationErrorKind(error);
    if (mutationErrorKind) {
      return taskMutationFailure(mutationErrorKind);
    }
    rethrowTaskActionError(
      error,
      "Failed to update task due date",
      "Failed to update task due date",
    );
  }
});

export const setTaskWorkspaceTags = withSession<
  AuthenticatedRequest &
    TaskTagWrite & { taskId: string; expectedWorkspaceTagIds?: string[] },
  ActionResultDto<TaskTagSnapshot, ActionError>
>(async (input) => {
  try {
    const task = await taskService.patchTask(input.taskId, {
      expectedWorkspaceTagIds: input.expectedWorkspaceTagIds,
      workspaceTagIds: input.workspaceTagIds,
      dismissedWorkspaceTagIds: input.dismissedWorkspaceTagIds,
      dismissedTopicIds: input.dismissedTopicIds,
    });
    revalidateTaskMutationRoutes();
    return toActionResult(ok(taskTagSnapshot(task)));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const moveTaskToWorkspace = withSession<
  MoveTaskToWorkspaceParameters,
  { taskId: string }
>(async ({ taskId, organizationId }) => {
  try {
    await taskService.moveTaskToWorkspace(taskId, organizationId);
    revalidateTaskMutationRoutes();
    return { taskId };
  } catch (error) {
    rethrowTaskActionError(
      error,
      "Failed to move task to workspace",
      "Failed to move task to workspace",
    );
  }
});

export const createTaskComment = withSession<CreateTaskCommentParameters, void>(
  async ({ taskId, comment, mentionedUserIds }) => {
    const trimmedComment = comment.trim();
    if (!trimmedComment) {
      return;
    }

    try {
      await taskService.createTaskEvent(taskId, {
        comment: trimmedComment,
        ...(mentionedUserIds?.length ? { mentionedUserIds } : {}),
      });
      revalidateTaskMutationRoutes();
    } catch (error) {
      rethrowTaskActionError(
        error,
        "Failed to create task comment",
        "Failed to create task comment",
      );
    }
  },
);

interface LoadOlderTaskActivityEventsParameters extends AuthenticatedRequest {
  taskId: string;
  untilEventId: string;
}

export const loadOlderTaskActivityEvents = withSession<
  LoadOlderTaskActivityEventsParameters,
  ActionResultDto<TaskEvent[], ActionError>
>(async ({ taskId, untilEventId }) => {
  try {
    const events = await taskService.listTaskEventsBefore(taskId, untilEventId);
    return toActionResult(ok(events));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

export const removeTaskParticipant = withSession<
  RemoveTaskParticipantParameters,
  ActionResultDto<{ taskId: string }, ActionError>
>(async ({ taskId, session }) => {
  try {
    await taskService.removeTaskParticipant(taskId, session.user.id);
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
  revalidateTaskMutationRoutes();
  return toActionResult(ok({ taskId }));
});

export const subscribeTaskParticipant = withSession<
  SubscribeTaskParticipantParameters,
  ActionResultDto<{ taskId: string }, ActionError>
>(async ({ taskId }) => {
  try {
    await taskService.subscribeTaskParticipant(taskId);
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
  revalidateTaskMutationRoutes();
  return toActionResult(ok({ taskId }));
});

export const createTaskLink = withSession<
  CreateTaskLinkParameters,
  { taskId: string; linkId: string; relatedTaskId: string }
>(async ({ taskId, relatedTaskId, relation, note, replaceExistingParent }) => {
  const normalizedTaskId = taskId.trim();
  const normalizedRelatedTaskId = relatedTaskId.trim();
  if (!normalizedTaskId || !normalizedRelatedTaskId) {
    throw new Error("Task required");
  }

  try {
    const parentLinksToReplace = await collectParentLinksToReplace({
      taskId: normalizedTaskId,
      nextParentTaskId: normalizedRelatedTaskId,
      relation,
      replaceExistingParent,
    });

    const link = await taskService.createTaskLink(normalizedTaskId, {
      toTaskId: normalizedRelatedTaskId,
      relation,
      note: normalizeLinkNote(note),
    });

    await deletePreviousParentLinks({
      taskId: normalizedTaskId,
      createdLinkId: link.id,
      parentLinksToReplace,
    });

    revalidateTaskMutationRoutes();
    return {
      taskId: normalizedTaskId,
      relatedTaskId: normalizedRelatedTaskId,
      linkId: link.id,
    };
  } catch (error) {
    rethrowTaskActionError(
      error,
      "Failed to create task link",
      "Failed to create task link",
    );
  }
});

export const deleteTaskLink = withSession<
  DeleteTaskLinkParameters,
  { taskId: string; linkId: string; relatedTaskId?: string }
>(async ({ taskId, linkId }) => {
  const normalizedTaskId = taskId.trim();
  const normalizedLinkId = linkId.trim();
  if (!normalizedTaskId || !normalizedLinkId) {
    throw new Error("Task link required");
  }

  try {
    const taskLinks = await taskService.listTaskLinks(normalizedTaskId);
    const link = taskLinks.find(
      (candidate) => candidate.id === normalizedLinkId,
    );

    await taskService.deleteTaskLink(normalizedTaskId, normalizedLinkId);
    revalidateTaskMutationRoutes();

    return {
      taskId: normalizedTaskId,
      linkId: normalizedLinkId,
      relatedTaskId: link?.peerTask.id,
    };
  } catch (error) {
    rethrowTaskActionError(
      error,
      "Failed to delete task link",
      "Failed to delete task link",
    );
  }
});

export const createTaskAndLink = withSession<
  CreateAndLinkTaskParameters,
  CreateTaskAndLinkResult
>(
  async ({
    taskId,
    name,
    tagSuggestionReceipt,
    workspaceTagIds,
    dismissedTopicIds,
    dismissedWorkspaceTagIds,
    description,
    assigneeId,
    assigneeSokoBotId,
    assigneeUserId,
    projectId,
    session,
    status,
    context,
    runAt,
    visibility,
    relation,
    note,
    replaceExistingParent,
  }) => {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) {
      throw new Error("Task required");
    }

    let createdTask: Task | null = null;

    try {
      createdTask = await createTaskFromDescription({
        description,
        name,
        tagSuggestionReceipt,
        workspaceTagIds,
        dismissedTopicIds,
        dismissedWorkspaceTagIds,
        assigneeId,
        assigneeSokoBotId,
        assigneeUserId,
        projectId,
        userId: session.user.id,
        context,
        status,
        runAt,
        visibility,
      });

      const parentLinksToReplace = await collectParentLinksToReplace({
        taskId: normalizedTaskId,
        nextParentTaskId: createdTask.id,
        relation,
        replaceExistingParent,
      });

      const link = await taskService.createTaskLink(normalizedTaskId, {
        toTaskId: createdTask.id,
        relation,
        note: normalizeLinkNote(note),
      });

      await deletePreviousParentLinks({
        taskId: normalizedTaskId,
        createdLinkId: link.id,
        parentLinksToReplace,
      });

      revalidateTaskMutationRoutes();
      return taskMutationSuccess({
        taskId: normalizedTaskId,
        createdTaskId: createdTask.id,
        linkId: link.id,
        name: createdTask.name,
        identifier: createdTask.identifier,
      });
    } catch (error) {
      if (createdTask) {
        await archiveCreatedTaskAfterFailure(createdTask.id);
      }
      const mutationErrorKind = toTaskMutationErrorKind(error);
      if (mutationErrorKind) {
        return taskMutationFailure(mutationErrorKind);
      }
      rethrowTaskActionError(
        error,
        "Failed to create and link task",
        "Failed to create and link task",
      );
    }
  },
);
