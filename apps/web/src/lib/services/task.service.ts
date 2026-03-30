import "server-only";

import type { TaskStatus } from "@sokosumi/database";

import { coreClient } from "@/lib/clients/core.client";
import type { Task, TaskEvent } from "@/lib/clients/generated/core/types.gen";

interface ListTasksParams {
  status?: TaskStatus | TaskStatus[];
  coworkerId?: string;
  cursor?: string | null;
  limit?: number;
}

interface CreateTaskInput {
  name: string;
  description: string | null;
  coworkerId: string | null;
  status?: Extract<TaskStatus, "DRAFT" | "READY">;
}

interface PatchTaskInput {
  name?: string;
  description?: string | null;
  coworkerId?: string | null;
}

interface CreateTaskEventInput {
  status?: TaskStatus;
  comment?: string;
}

export const taskService = (() => {
  async function listTasks(params: ListTasksParams = {}) {
    const result = await coreClient.getTasks({
      status: Array.isArray(params.status)
        ? params.status
        : params.status
          ? [params.status]
          : undefined,
      coworkerId: params.coworkerId,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    });

    return {
      tasks: result.data,
      pagination: result.meta?.pagination ?? null,
    };
  }

  async function getTaskById(
    taskId: string,
    scope: Array<"context" | "owned"> = ["context"],
  ): Promise<Task | null> {
    try {
      const result = await coreClient.getTaskById(taskId, scope);
      return result.data;
    } catch {
      return null;
    }
  }

  async function createTask(input: CreateTaskInput): Promise<Task> {
    const result = await coreClient.createTask(input);

    if (!result.data) {
      throw new Error("Failed to create task");
    }

    return result.data;
  }

  async function createTaskEvent(
    taskId: string,
    input: CreateTaskEventInput,
  ): Promise<TaskEvent> {
    const result = await coreClient.createTaskEvent(taskId, input);

    if (!result.data) {
      throw new Error("Failed to create task event");
    }

    return result.data;
  }

  async function patchTask(
    taskId: string,
    input: PatchTaskInput,
  ): Promise<Task> {
    const result = await coreClient.patchTask(taskId, input);

    if (!result.data) {
      throw new Error("Failed to update task");
    }

    return result.data;
  }

  async function moveTaskToWorkspace(
    taskId: string,
    organizationId: string | null,
  ): Promise<Task> {
    const result = await coreClient.moveTaskToWorkspace(taskId, {
      organizationId,
    });

    if (!result.data) {
      throw new Error("Failed to move task to workspace");
    }

    return result.data;
  }

  async function deleteTask(taskId: string): Promise<Task> {
    const result = await coreClient.deleteTask(taskId);

    if (!result.data) {
      throw new Error("Failed to delete task");
    }

    return result.data;
  }

  return {
    listTasks,
    getTaskById,
    createTask,
    createTaskEvent,
    moveTaskToWorkspace,
    patchTask,
    deleteTask,
  };
})();
