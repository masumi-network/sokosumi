"use server";

import { TaskLinkType, TaskStatus } from "@sokosumi/utils";
import { revalidatePath } from "next/cache";

import { toCoreApiActionError } from "@/lib/clients/core.client";
import type {
  Task,
  TaskLink,
  TaskLinkRelation,
} from "@/lib/clients/generated/core/types.gen";
import { designMdService } from "@/lib/services/design-md.service";
import { taskService } from "@/lib/services/task.service";
import { normalizeOptionalProjectId } from "@/lib/utils/project";
import { normalizeTaskNameForCoreApi } from "@/lib/utils/task-transformer";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface CreateTaskParameters extends AuthenticatedRequest {
  description: string;
  coworkerId: string | null;
  projectId?: string | null;
  skipDesignMdAttachment?: boolean;
  status: Extract<TaskStatus, "DRAFT" | "READY">;
}

interface UpdateTaskParameters extends AuthenticatedRequest {
  taskId: string;
  name: string;
  description: string;
  coworkerId: string | null;
  projectId?: string | null;
  currentStatus: TaskStatus;
  desiredStatus: TaskStatus;
}

interface SetTaskStatusFromDragParameters extends AuthenticatedRequest {
  taskId: string;
  desiredStatus: TaskStatus;
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
  type: TaskLinkType;
  direction?: "outgoing" | "incoming";
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
  coworkerId: string | null;
  projectId?: string | null;
  skipDesignMdAttachment?: boolean;
  status: Extract<TaskStatus, "DRAFT" | "READY">;
  type: TaskLinkType;
  direction?: "outgoing" | "incoming";
  note?: string | null;
  replaceExistingParent?: boolean;
}

function normalizeLinkNote(note?: string | null): string | null | undefined {
  if (typeof note === "undefined") {
    return undefined;
  }

  const trimmedNote = note?.trim();
  return trimmedNote ? trimmedNote : null;
}

function taskLinkTypeAndDirectionToRelation(
  type: TaskLinkType,
  direction: "outgoing" | "incoming",
): TaskLinkRelation {
  switch (type) {
    case TaskLinkType.RELATES:
      return "related";
    case TaskLinkType.BLOCKS:
      return direction === "outgoing" ? "blocks" : "blocked_by";
    case TaskLinkType.PARENT:
      return direction === "outgoing" ? "parent" : "child";
    case TaskLinkType.DUPLICATE:
      return "duplicate";
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unsupported link type: ${_exhaustive}`);
    }
  }
}

function revalidateTaskMutationRoutes(taskId: string, relatedTaskId?: string) {
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);

  if (relatedTaskId) {
    revalidatePath(`/tasks/${relatedTaskId}`);
  }
}

async function createTaskFromDescription(input: {
  description: string;
  coworkerId: string | null;
  projectId?: string | null;
  skipDesignMdAttachment?: boolean;
  status: Extract<TaskStatus, "DRAFT" | "READY">;
}): Promise<Task> {
  const trimmedDescription = input.description.trim();
  if (!trimmedDescription) {
    throw new Error("Description required");
  }

  const normalizedProjectId = normalizeOptionalProjectId(input.projectId);
  const descriptionWithDesignMd = input.skipDesignMdAttachment
    ? trimmedDescription
    : await designMdService.appendDesignMdToDescription(trimmedDescription);

  return taskService.createTask({
    description: descriptionWithDesignMd,
    coworkerId: input.coworkerId ? input.coworkerId : null,
    projectId: normalizedProjectId ?? null,
    status: input.status,
  });
}

async function collectParentLinksToReplace(input: {
  taskId: string;
  nextParentTaskId: string;
  type: TaskLinkType;
  direction: "outgoing" | "incoming";
  replaceExistingParent?: boolean;
}): Promise<TaskLink[]> {
  const shouldReplaceParent =
    input.type === TaskLinkType.PARENT &&
    input.direction === "incoming" &&
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
    coworkerId,
    projectId,
    session,
    skipDesignMdAttachment,
    status,
  }) => {
    try {
      const task = await createTaskFromDescription({
        description,
        coworkerId,
        projectId,
        skipDesignMdAttachment,
        status,
      });

      revalidatePath("/tasks");
      revalidatePath("/projects");
      return { taskId: task.id, name: task.name };
    } catch (error) {
      console.error("Failed to create task", error);
      throw new Error("Failed to create task");
    }
  },
);

export const updateTask = withSession<UpdateTaskParameters, { taskId: string }>(
  async ({
    taskId,
    name,
    description,
    coworkerId,
    projectId,
    currentStatus,
    desiredStatus,
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
        coworkerId: coworkerId?.trim() ? coworkerId : null,
        ...(typeof normalizedProjectId !== "undefined"
          ? { projectId: normalizedProjectId }
          : {}),
      });

      if (desiredStatus !== currentStatus) {
        await taskService.createTaskEvent(taskId, {
          status: desiredStatus,
        });
      }

      revalidatePath("/tasks");
      revalidatePath(`/tasks/${taskId}`);
      if (typeof normalizedProjectId !== "undefined") {
        revalidatePath("/projects");
      }
      return { taskId };
    } catch (error) {
      console.error("Failed to update task", error);
      throw new Error("Failed to update task");
    }
  },
);

export const setTaskStatusFromDrag = withSession<
  SetTaskStatusFromDragParameters,
  { taskId: string }
>(async ({ taskId, desiredStatus }) => {
  try {
    await taskService.createTaskEvent(taskId, {
      status: desiredStatus,
    });

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);
    return { taskId };
  } catch (error) {
    console.error("Failed to update task status", error);
    throw new Error("Failed to update task status");
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
      console.error("Failed to delete task", error);
      throw new Error("Failed to delete task");
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
    console.error("Failed to move task to workspace", error);
    const { message } = toCoreApiActionError(error);
    throw new Error(message ?? "Failed to move task to workspace");
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
      console.error("Failed to create task comment", error);
      throw new Error("Failed to create task comment");
    }
  },
);

export const createTaskLink = withSession<
  CreateTaskLinkParameters,
  { taskId: string; linkId: string; relatedTaskId: string }
>(
  async ({
    taskId,
    relatedTaskId,
    type,
    direction,
    note,
    replaceExistingParent,
  }) => {
    const normalizedTaskId = taskId.trim();
    const normalizedRelatedTaskId = relatedTaskId.trim();
    if (!normalizedTaskId || !normalizedRelatedTaskId) {
      throw new Error("Task required");
    }

    const normalizedDirection = direction ?? "outgoing";
    const relation = taskLinkTypeAndDirectionToRelation(
      type,
      normalizedDirection,
    );

    try {
      const parentLinksToReplace = await collectParentLinksToReplace({
        taskId: normalizedTaskId,
        nextParentTaskId: normalizedRelatedTaskId,
        type,
        direction: normalizedDirection,
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
      console.error("Failed to create task link", error);
      const { message } = toCoreApiActionError(error);
      throw new Error(message ?? "Failed to create task link");
    }
  },
);

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
    console.error("Failed to delete task link", error);
    const { message } = toCoreApiActionError(error);
    throw new Error(message ?? "Failed to delete task link");
  }
});

export const createTaskAndLink = withSession<
  CreateAndLinkTaskParameters,
  { taskId: string; createdTaskId: string; linkId: string; name: string }
>(
  async ({
    taskId,
    description,
    coworkerId,
    projectId,
    session,
    status,
    skipDesignMdAttachment,
    type,
    direction,
    note,
    replaceExistingParent,
  }) => {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) {
      throw new Error("Task required");
    }

    const normalizedDirection = direction ?? "outgoing";
    const relation = taskLinkTypeAndDirectionToRelation(
      type,
      normalizedDirection,
    );

    let createdTask: Task | null = null;

    try {
      createdTask = await createTaskFromDescription({
        description,
        coworkerId,
        projectId,
        skipDesignMdAttachment,
        status,
      });

      const parentLinksToReplace = await collectParentLinksToReplace({
        taskId: normalizedTaskId,
        nextParentTaskId: createdTask.id,
        type,
        direction: normalizedDirection,
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
      console.error("Failed to create and link task", error);
      const { message } = toCoreApiActionError(error);
      throw new Error(message ?? "Failed to create and link task");
    }
  },
);
