"use server";

import {
  buildAdHocDesignMdPrefix,
  hasActiveTaskSchedule,
  userTaskStatusTransitionRequiresComment,
} from "@sokosumi/utils";
import { revalidatePath } from "next/cache";

import {
  CoreApiRequestError,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import {
  type Task,
  type TaskLink,
  TaskLinkRelation,
  TaskStatus,
  type UserWritableTaskLinkRelation,
} from "@/lib/clients/generated/core";
import { designMdService } from "@/lib/services/design-md.service";
import { projectFilesService } from "@/lib/services/project-files.service";
import { taskService } from "@/lib/services/task.service";
import { taskScheduleService } from "@/lib/services/task-schedule.service";
import type { TaskScheduleSelection } from "@/lib/types/task-schedule";
import { normalizeOptionalProjectId } from "@/lib/utils/project";
import { sanitizeTaskAttachmentLabel } from "@/lib/utils/task-attachments";
import {
  hasTaskScheduleChanged,
  selectionToApiBody,
} from "@/lib/utils/task-schedule";
import { normalizeTaskNameForCoreApi } from "@/lib/utils/task-transformer";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface CreateTaskParameters extends AuthenticatedRequest {
  description: string;
  assigneeId: string | null;
  projectId?: string | null;
  skipDesignMdAttachment?: boolean;
  skipProjectBriefingAttachment?: boolean;
  skipProjectContextMdAttachment?: boolean;
  /** Attach this DESIGN.md instead of resolving the caller's own effective
   * one — e.g. a task-scoped "use a different company's branding" pick.
   * Ignored when `skipDesignMdAttachment` is true. */
  designMdAttachmentOverride?: { label: string; url: string };
  status: Extract<TaskStatus, "DRAFT" | "READY">;
  schedule?: TaskScheduleSelection;
}

interface UpdateTaskParameters extends AuthenticatedRequest {
  taskId: string;
  name: string;
  description: string;
  assigneeId: string | null;
  projectId?: string | null;
  currentStatus: TaskStatus;
  desiredStatus: TaskStatus;
  schedule?: TaskScheduleSelection;
  hadSchedule?: boolean;
  originalSchedule?: TaskScheduleSelection;
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
  projectId?: string | null;
  skipDesignMdAttachment?: boolean;
  skipProjectBriefingAttachment?: boolean;
  skipProjectContextMdAttachment?: boolean;
  designMdAttachmentOverride?: { label: string; url: string };
  status: Extract<TaskStatus, "DRAFT" | "READY">;
  schedule?: TaskScheduleSelection;
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

async function applyTaskSchedule(
  taskId: string,
  schedule: TaskScheduleSelection,
  hadSchedule: boolean,
): Promise<TaskStatus | null> {
  if (schedule.mode === "none") {
    if (hadSchedule) {
      const task = await taskScheduleService.clearSchedule(taskId);
      return task.status;
    }
    return null;
  }

  const body = selectionToApiBody(schedule);
  if (!body) {
    throw new Error("Invalid schedule");
  }

  const task = await taskScheduleService.setSchedule(taskId, body);
  return task.status;
}

function resolveUpdateTargetStatus(
  desiredStatus: TaskStatus,
  statusAfterSchedule: TaskStatus,
  scheduleWasMutated: boolean,
  scheduleActiveOnServer: boolean,
): TaskStatus {
  if (scheduleWasMutated) {
    if (scheduleActiveOnServer) {
      return statusAfterSchedule;
    }

    if (desiredStatus === TaskStatus.QUEUED) {
      return statusAfterSchedule;
    }

    return desiredStatus;
  }

  if (scheduleActiveOnServer && desiredStatus !== TaskStatus.QUEUED) {
    return statusAfterSchedule;
  }

  return desiredStatus;
}

function resolveCreateStatus(
  requestedStatus: Extract<TaskStatus, "DRAFT" | "READY">,
  schedule?: TaskScheduleSelection,
): Extract<TaskStatus, "DRAFT" | "READY"> {
  if (!schedule || schedule.mode === "none") {
    return requestedStatus;
  }

  return TaskStatus.DRAFT;
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
 * Ad hoc overrides are the only client-supplied DESIGN.md attach path.
 * Description text is already freeform, but this gate still keeps the
 * privileged prepend limited to https blobs under this user's ad hoc prefix
 * and strips markdown-breaking brackets from the label.
 */
function resolveDesignMdAttachmentOverride(
  override: { label: string; url: string },
  userId: string,
): { label: string; url: string } {
  let parsed: URL;
  try {
    parsed = new URL(override.url.trim());
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

  return {
    label: sanitizeTaskAttachmentLabel(override.label, "DESIGN.md"),
    url: parsed.href,
  };
}

async function createTaskFromDescription(input: {
  description: string;
  assigneeId: string | null;
  projectId?: string | null;
  userId: string;
  skipDesignMdAttachment?: boolean;
  skipProjectBriefingAttachment?: boolean;
  skipProjectContextMdAttachment?: boolean;
  designMdAttachmentOverride?: { label: string; url: string };
  status: Extract<TaskStatus, "DRAFT" | "READY">;
  schedule?: TaskScheduleSelection;
}): Promise<Task> {
  const trimmedDescription = input.description.trim();
  if (!trimmedDescription) {
    throw new Error("Description required");
  }

  const normalizedProjectId = normalizeOptionalProjectId(input.projectId);
  const descriptionWithProjectFiles = normalizedProjectId
    ? await projectFilesService.appendProjectFilesToDescription(
        trimmedDescription,
        normalizedProjectId,
        {
          skipBriefing: input.skipProjectBriefingAttachment,
          skipContextMd: input.skipProjectContextMdAttachment,
        },
      )
    : trimmedDescription;
  const descriptionWithDesignMd = input.skipDesignMdAttachment
    ? descriptionWithProjectFiles
    : input.designMdAttachmentOverride
      ? designMdService.withDesignMdAttachment(
          descriptionWithProjectFiles,
          resolveDesignMdAttachmentOverride(
            input.designMdAttachmentOverride,
            input.userId,
          ),
        )
      : await designMdService.appendDesignMdToDescription(
          descriptionWithProjectFiles,
        );

  const task = await taskService.createTask({
    description: descriptionWithDesignMd,
    assigneeId: input.assigneeId ? input.assigneeId : null,
    projectId: normalizedProjectId ?? null,
    status: resolveCreateStatus(input.status, input.schedule),
  });

  try {
    if (
      input.status !== TaskStatus.DRAFT &&
      input.schedule &&
      input.schedule.mode !== "none"
    ) {
      await applyTaskSchedule(task.id, input.schedule, false);
    }
    return task;
  } catch (error) {
    await archiveCreatedTaskAfterFailure(task.id);
    throw error;
  }
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

export const createTask = withSession<
  CreateTaskParameters,
  { taskId: string; name: string }
>(
  async ({
    description,
    assigneeId,
    projectId,
    session,
    skipDesignMdAttachment,
    skipProjectBriefingAttachment,
    skipProjectContextMdAttachment,
    designMdAttachmentOverride,
    status,
    schedule,
  }) => {
    try {
      const task = await createTaskFromDescription({
        description,
        assigneeId,
        projectId,
        userId: session.user.id,
        skipDesignMdAttachment,
        skipProjectBriefingAttachment,
        skipProjectContextMdAttachment,
        designMdAttachmentOverride,
        status,
        schedule,
      });

      revalidatePath("/tasks");
      revalidatePath("/projects");
      return { taskId: task.id, name: task.name };
    } catch (error) {
      rethrowTaskActionError(
        error,
        "Failed to create task",
        "Failed to create task",
      );
    }
  },
);

export const updateTask = withSession<UpdateTaskParameters, { taskId: string }>(
  async ({
    taskId,
    name,
    description,
    assigneeId,
    projectId,
    currentStatus,
    desiredStatus,
    schedule,
    hadSchedule = false,
    originalSchedule,
  }) => {
    const trimmedDescription = description.trim();
    const trimmedName = normalizeTaskNameForCoreApi(name);
    if (!trimmedDescription) {
      throw new Error("Description required");
    }
    if (!trimmedName) {
      throw new Error("Name required");
    }

    try {
      const normalizedProjectId = normalizeOptionalProjectId(projectId);

      await taskService.patchTask(taskId, {
        name: trimmedName,
        description: trimmedDescription,
        assigneeId: assigneeId?.trim() ? assigneeId : null,
        ...(typeof normalizedProjectId !== "undefined"
          ? { projectId: normalizedProjectId }
          : {}),
      });

      let statusAfterSchedule = currentStatus;
      let scheduleActiveOnServer = hadSchedule || schedule?.mode !== "none";
      const scheduleChanged =
        schedule &&
        hasTaskScheduleChanged(
          originalSchedule ?? { mode: "none", timezone: "UTC" },
          schedule,
          hadSchedule,
        );

      const shouldClearScheduleForStatusChange =
        !scheduleChanged &&
        schedule &&
        schedule.mode !== "none" &&
        desiredStatus !== TaskStatus.QUEUED &&
        desiredStatus !== currentStatus;

      let scheduleWasMutated = false;

      if (shouldClearScheduleForStatusChange) {
        scheduleWasMutated = true;
        const scheduleStatus = await applyTaskSchedule(
          taskId,
          { mode: "none", timezone: schedule.timezone },
          true,
        );
        if (scheduleStatus !== null) {
          statusAfterSchedule = scheduleStatus;
        }
        scheduleActiveOnServer = false;
      }

      if (schedule && scheduleChanged) {
        scheduleWasMutated = true;
        const scheduleStatus = await applyTaskSchedule(
          taskId,
          schedule,
          hadSchedule,
        );
        if (scheduleStatus !== null) {
          statusAfterSchedule = scheduleStatus;
        }
        scheduleActiveOnServer = schedule.mode !== "none";
      }

      const targetStatus = resolveUpdateTargetStatus(
        desiredStatus,
        statusAfterSchedule,
        scheduleWasMutated,
        scheduleActiveOnServer,
      );

      if (targetStatus !== statusAfterSchedule) {
        await taskService.createTaskEvent(taskId, {
          status: targetStatus,
        });
      }

      revalidatePath("/tasks");
      revalidatePath(`/tasks/${taskId}`);
      if (typeof normalizedProjectId !== "undefined") {
        revalidatePath("/projects");
      }
      return { taskId };
    } catch (error) {
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
  { taskId: string }
>(async ({ taskId, desiredStatus, comment }) => {
  try {
    const task = await taskService.getTaskById(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    const currentStatus = task.status as TaskStatus;
    let statusAfterSchedule = currentStatus;

    const shouldClearSchedule =
      currentStatus === TaskStatus.QUEUED &&
      desiredStatus !== TaskStatus.QUEUED &&
      hasActiveTaskSchedule(task.metadata, task.nextRunAt);

    if (shouldClearSchedule) {
      const clearedTask = await taskScheduleService.clearSchedule(taskId);
      statusAfterSchedule = clearedTask.status as TaskStatus;
    }

    if (desiredStatus !== statusAfterSchedule) {
      const trimmedComment = comment?.trim();
      if (
        userTaskStatusTransitionRequiresComment(
          statusAfterSchedule,
          desiredStatus,
        ) &&
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
    return { taskId };
  } catch (error) {
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
  async ({ taskId, comment }) => {
    const trimmedComment = comment.trim();
    if (!trimmedComment) {
      return;
    }

    try {
      await taskService.createTaskEvent(taskId, {
        comment: trimmedComment,
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
  { taskId: string; createdTaskId: string; linkId: string; name: string }
>(
  async ({
    taskId,
    description,
    assigneeId,
    projectId,
    session,
    status,
    skipDesignMdAttachment,
    skipProjectBriefingAttachment,
    skipProjectContextMdAttachment,
    designMdAttachmentOverride,
    schedule,
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
        projectId,
        userId: session.user.id,
        skipDesignMdAttachment,
        skipProjectBriefingAttachment,
        skipProjectContextMdAttachment,
        designMdAttachmentOverride,
        status,
        schedule,
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
      return {
        taskId: normalizedTaskId,
        createdTaskId: createdTask.id,
        linkId: link.id,
        name: createdTask.name,
      };
    } catch (error) {
      if (createdTask) {
        await archiveCreatedTaskAfterFailure(createdTask.id);
      }
      rethrowTaskActionError(
        error,
        "Failed to create and link task",
        "Failed to create and link task",
      );
    }
  },
);
