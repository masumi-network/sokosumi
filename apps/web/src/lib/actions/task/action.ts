"use server";

import { TaskStatus } from "@sokosumi/database";
import { revalidatePath } from "next/cache";

import { openrouterClient } from "@/lib/clients/openrouter.client";
import { taskService } from "@/lib/services/task.service";
import {
  type AuthenticatedRequest,
  withAuthContext,
} from "@/middleware/auth-middleware";

interface CreateTaskParameters extends AuthenticatedRequest {
  description: string;
  orchestratorId: string | null;
  orchestratorName: string;
  status: TaskStatus;
}

interface UpdateTaskParameters extends AuthenticatedRequest {
  taskId: string;
  name: string;
  description: string;
  orchestratorId: string | null;
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

interface CreateTaskCommentParameters extends AuthenticatedRequest {
  taskId: string;
  comment: string;
}

function buildFallbackName(description: string): string {
  const firstLine = description.split("\n").find((line) => line.trim());

  return (firstLine ?? "").trim().slice(0, 60);
}

export const createTask = withAuthContext<
  CreateTaskParameters,
  { taskId: string }
>(
  async ({
    description,
    orchestratorId,
    orchestratorName: _orchestratorName,
    status,
  }) => {
    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      throw new Error("Description required");
    }

    try {
      const generatedName =
        await openrouterClient.generateTaskName(trimmedDescription);
      const candidate = generatedName ?? buildFallbackName(description);
      const name = candidate.trim() || "Untitled Task";
      const task = await taskService.createTask({
        name,
        description: trimmedDescription,
        orchestratorId: orchestratorId?.trim() ? orchestratorId : null,
      });

      if (status === TaskStatus.READY) {
        await taskService.createTaskEvent(task.id, {
          status: TaskStatus.READY,
        });
      }

      revalidatePath("/tasks");
      return { taskId: task.id };
    } catch (error) {
      console.error("Failed to create task", error);
      throw new Error("Failed to create task");
    }
  },
);

export const updateTask = withAuthContext<
  UpdateTaskParameters,
  { taskId: string }
>(
  async ({
    taskId,
    name,
    description,
    orchestratorId,
    currentStatus,
    desiredStatus,
  }) => {
    const trimmedDescription = description.trim();
    const trimmedName = name.trim();
    if (!trimmedDescription) {
      throw new Error("Description required");
    }
    if (!trimmedName) {
      throw new Error("Name required");
    }

    try {
      await taskService.patchTask(taskId, {
        name: trimmedName,
        description: trimmedDescription,
        orchestratorId: orchestratorId?.trim() ? orchestratorId : null,
      });

      if (desiredStatus !== currentStatus) {
        await taskService.createTaskEvent(taskId, {
          status: desiredStatus,
        });
      }

      revalidatePath("/tasks");
      revalidatePath(`/tasks/${taskId}`);
      return { taskId };
    } catch (error) {
      console.error("Failed to update task", error);
      throw new Error("Failed to update task");
    }
  },
);

export const setTaskStatusFromDrag = withAuthContext<
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

export const deleteTask = withAuthContext<
  DeleteTaskParameters,
  { taskId: string }
>(async ({ taskId }) => {
  try {
    await taskService.deleteTask(taskId);
    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);
    return { taskId };
  } catch (error) {
    console.error("Failed to delete task", error);
    throw new Error("Failed to delete task");
  }
});

export const createTaskComment = withAuthContext<
  CreateTaskCommentParameters,
  void
>(async ({ taskId, comment }) => {
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
});
