"use server";

import {
  buildAdHocDesignMdPrefix,
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
import {
  type CreateTaskContext,
  type Task,
  type TaskLink,
  TaskLinkRelation,
  TaskStatus,
  type UserWritableTaskLinkRelation,
} from "@/lib/clients/generated/core";
import { taskService } from "@/lib/services/task.service";
import { normalizeOptionalProjectId } from "@/lib/utils/project";
import {
  TASK_MUTATION_ERROR_KINDS,
  type TaskMutationErrorKind,
} from "@/lib/utils/task-mutation-error-kinds";
import { normalizeTaskNameForCoreApi } from "@/lib/utils/task-transformer";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface CreateTaskParameters extends AuthenticatedRequest {
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

export interface TaskContextSelectionInput {
  brand: {
    enabled: boolean;
    source: "project" | "default" | "custom";
    custom?: { url: string } | null;
  };
  briefingEnabled: boolean;
  contextMdEnabled: boolean;
}

interface UpdateTaskParameters extends AuthenticatedRequest {
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
}>;
type UpdateTaskResult = TaskMutationActionResult<{ taskId: string }>;
type SetTaskStatusResult = TaskMutationActionResult<{ taskId: string }>;
type CreateTaskAndLinkResult = TaskMutationActionResult<{
  taskId: string;
  createdTaskId: string;
  linkId: string;
  name: string;
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

interface DeleteTaskParameters extends AuthenticatedRequest {
  taskId: string;
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
  userId: string;
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

interface CreateAndLinkTaskParameters extends AuthenticatedRequest {
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

/** Queued needs a Run at (ADR 0041), so a Queued create without one is Ready. */
function resolveCreateStatus(
  requestedStatus: Extract<TaskStatus, "DRAFT" | "READY" | "QUEUED">,
): Extract<TaskStatus, "DRAFT" | "READY"> {
  return requestedStatus === TaskStatus.QUEUED
    ? TaskStatus.READY
    : requestedStatus;
}

function normalizeLinkNote(note?: string | null): string | null | undefined {
  if (typeof note === "undefined") {
    return undefined;
  }

  const trimmedNote = note?.trim();
  return trimmedNote ? trimmedNote : null;
}

function revalidateTaskMutationRoutes(taskId: string, relatedTaskId?: string) {
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);

  if (relatedTaskId) {
    revalidatePath(`/tasks/${relatedTaskId}`);
  }
}

/**
 * Ad hoc overrides are the only client-supplied DESIGN.md attach path. Keep
 * them limited to https blobs under the caller's own ad hoc prefix before
 * forwarding the URL to Core, which performs its own DESIGN.md URL check.
 */
function resolveDesignMdAttachmentUrl(url: string, userId: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("Invalid DESIGN.md attachment URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("DESIGN.md attachment URL must use https");
  }

  const expectedPathPrefix = `/${buildAdHocDesignMdPrefix(userId)}`;
  if (!parsed.pathname.startsWith(expectedPathPrefix)) {
    throw new Error("DESIGN.md attachment URL is not valid for this user");
  }

  return parsed.href;
}

function toCoreTaskContext(
  selection: TaskContextSelectionInput,
  userId: string,
): CreateTaskContext {
  if (!selection.brand.enabled) {
    return {
      brand: false,
      briefing: selection.briefingEnabled,
      memory: selection.contextMdEnabled,
    };
  }

  if (selection.brand.source === "custom") {
    if (!selection.brand.custom) {
      throw new Error("Custom DESIGN.md attachment required");
    }

    const customUrl = selection.brand.custom.url;
    let brandUrl: string;
    try {
      brandUrl = resolveDesignMdAttachmentUrl(customUrl, userId);
    } catch (error) {
      // Edit may still carry a stored DESIGN.md that is not under this user's
      // ad-hoc prefix (stale project/workspace brand). Forward non-adhoc https
      // URLs so Core can grandfather the existing attachment. Foreign ad-hoc
      // prefixes still fail here.
      let pathname = "";
      try {
        const parsed = new URL(customUrl);
        if (parsed.protocol !== "https:") {
          throw new Error("DESIGN.md attachment URL must use https");
        }
        pathname = decodeURIComponent(parsed.pathname);
      } catch (parseError) {
        if (
          parseError instanceof Error &&
          parseError.message === "DESIGN.md attachment URL must use https"
        ) {
          throw parseError;
        }
        throw error;
      }
      if (pathname.startsWith("/design-md/adhoc/")) {
        throw error;
      }
      if (!pathname.startsWith("/design-md/")) {
        throw error;
      }
      brandUrl = customUrl;
    }

    return {
      brand: {
        url: brandUrl,
      },
      briefing: selection.briefingEnabled,
      memory: selection.contextMdEnabled,
    };
  }

  return {
    brand: true,
    brandSource: selection.brand.source === "project" ? "project" : "workspace",
    briefing: selection.briefingEnabled,
    memory: selection.contextMdEnabled,
  };
}

function resolveAssigneeWrite(
  assigneeId?: string | null,
  assigneeSokoBotId?: string | null,
  assigneeUserId?: string | null,
): {
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  assigneeUserId: string | null;
} {
  const sokoBotId = assigneeSokoBotId?.trim() || null;
  if (sokoBotId) {
    return {
      assigneeId: null,
      assigneeSokoBotId: sokoBotId,
      assigneeUserId: null,
    };
  }

  const userId =
    typeof assigneeUserId === "string" ? assigneeUserId.trim() || null : null;
  if (userId) {
    return {
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: userId,
    };
  }

  return {
    assigneeId: assigneeId?.trim() ? assigneeId : null,
    assigneeSokoBotId: null,
    assigneeUserId: null,
  };
}

async function createTaskFromDescription(input: {
  name?: string;
  description: string;
  assigneeId: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  projectId?: string | null;
  userId: string;
  context?: TaskContextSelectionInput;
  status: Extract<TaskStatus, "DRAFT" | "READY" | "QUEUED">;
  runAt?: string;
  visibility?: "PUBLIC" | "PRIVATE";
}): Promise<Task> {
  const trimmedDescription = input.description.trim();
  if (!trimmedDescription) {
    throw new Error("Description required");
  }

  const normalizedProjectId = normalizeOptionalProjectId(input.projectId);
  const context = input.context
    ? toCoreTaskContext(input.context, input.userId)
    : undefined;

  const assigneeWrite = resolveAssigneeWrite(
    input.assigneeId,
    input.assigneeSokoBotId,
    input.assigneeUserId,
  );
  const trimmedName = input.name
    ? normalizeTaskNameForCoreApi(input.name)
    : undefined;

  return taskService.createTask({
    description: trimmedDescription,
    ...assigneeWrite,
    projectId: normalizedProjectId ?? null,
    ...(context ? { context } : {}),
    // Core creates a Task with a Run at in Queued and ignores its status.
    ...(input.runAt
      ? { runAt: new Date(input.runAt) }
      : { status: resolveCreateStatus(input.status) }),
    ...(input.visibility ? { visibility: input.visibility } : {}),
    ...(trimmedName ? { name: trimmedName } : {}),
  });
}

async function collectParentLinksToReplace(input: {
  taskId: string;
  nextParentTaskId: string;
  relation: UserWritableTaskLinkRelation;
  replaceExistingParent?: boolean;
}): Promise<TaskLink[]> {
  const shouldReplaceParent =
    input.relation === TaskLinkRelation.CHILD &&
    input.replaceExistingParent !== false;

  if (!shouldReplaceParent) {
    return [];
  }

  const links = await taskService.listTaskLinks(input.taskId);
  return links.filter(
    (link) =>
      link.relation === "child" && link.peerTask.id !== input.nextParentTaskId,
  );
}

async function restoreParentLinks(
  taskId: string,
  parentLinks: TaskLink[],
): Promise<void> {
  for (const parentLink of parentLinks) {
    await taskService.createTaskLink(taskId, {
      toTaskId: parentLink.peerTask.id,
      relation: "child",
      note: parentLink.note,
    });
  }
}

async function rollbackCreatedParentLink(input: {
  taskId: string;
  createdLinkId: string;
  deletedParentLinks: TaskLink[];
}): Promise<void> {
  const rollbackFailures: string[] = [];

  try {
    await taskService.deleteTaskLink(input.taskId, input.createdLinkId);
  } catch (rollbackError) {
    console.error("Failed to rollback created parent link", rollbackError);
    rollbackFailures.push(
      rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError),
    );
  }

  try {
    await restoreParentLinks(input.taskId, input.deletedParentLinks);
  } catch (rollbackError) {
    console.error("Failed to restore previous parent links", rollbackError);
    rollbackFailures.push(
      rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError),
    );
  }

  if (rollbackFailures.length > 0) {
    throw new Error(
      `Task links may be inconsistent after a failed parent replacement. Rollback failed: ${rollbackFailures.join("; ")}`,
    );
  }
}

async function deletePreviousParentLinks(input: {
  taskId: string;
  createdLinkId: string;
  parentLinksToReplace: TaskLink[];
}): Promise<void> {
  const deletedParentLinks: TaskLink[] = [];

  try {
    for (const parentLink of input.parentLinksToReplace) {
      await taskService.deleteTaskLink(input.taskId, parentLink.id);
      deletedParentLinks.push(parentLink);
    }
  } catch (error) {
    try {
      await rollbackCreatedParentLink({
        taskId: input.taskId,
        createdLinkId: input.createdLinkId,
        deletedParentLinks,
      });
    } catch (rollbackError) {
      const originalMessage =
        error instanceof Error ? error.message : String(error);
      const rollbackMessage =
        rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError);
      throw new Error(
        `${rollbackMessage} (while recovering from: ${originalMessage})`,
      );
    }
    throw error;
  }
}

async function archiveCreatedTaskAfterFailure(taskId: string): Promise<void> {
  try {
    await taskService.deleteTask(taskId);
  } catch (cleanupError) {
    console.error(
      "Failed to archive created task after link failure",
      cleanupError,
    );
  }
}

export const createTask = withSession<CreateTaskParameters, CreateTaskResult>(
  async ({
    name,
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
      return taskMutationSuccess({ taskId: task.id, name: task.name });
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

      revalidatePath("/tasks");
      revalidatePath(`/tasks/${taskId}`);
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

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);
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

export const deleteTask = withSession<DeleteTaskParameters, { taskId: string }>(
  async ({ taskId }) => {
    try {
      await taskService.deleteTask(taskId);
      revalidatePath("/tasks");
      revalidatePath(`/tasks/${taskId}`);
      return { taskId };
    } catch (error) {
      rethrowTaskActionError(
        error,
        "Failed to delete task",
        "Failed to delete task",
      );
    }
  },
);

export const moveTaskToWorkspace = withSession<
  MoveTaskToWorkspaceParameters,
  { taskId: string }
>(async ({ taskId, organizationId }) => {
  try {
    await taskService.moveTaskToWorkspace(taskId, organizationId);
    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);
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
      revalidatePath("/tasks");
      revalidatePath(`/tasks/${taskId}`);
    } catch (error) {
      rethrowTaskActionError(
        error,
        "Failed to create task comment",
        "Failed to create task comment",
      );
    }
  },
);

export const removeTaskParticipant = withSession<
  RemoveTaskParticipantParameters,
  ActionResultDto<{ taskId: string; userId: string }, ActionError>
>(async ({ taskId, userId }) => {
  try {
    await taskService.removeTaskParticipant(taskId, userId);
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);
  return toActionResult(ok({ taskId, userId }));
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
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);
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

    revalidateTaskMutationRoutes(normalizedTaskId, normalizedRelatedTaskId);
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
    revalidateTaskMutationRoutes(normalizedTaskId, link?.peerTask.id);

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

      revalidateTaskMutationRoutes(normalizedTaskId, createdTask.id);
      return taskMutationSuccess({
        taskId: normalizedTaskId,
        createdTaskId: createdTask.id,
        linkId: link.id,
        name: createdTask.name,
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
