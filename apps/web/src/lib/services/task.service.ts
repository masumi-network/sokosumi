import "server-only";

import { type TaskEvent, TaskStatus } from "@sokosumi/database";

import { type CoreApiResponse, coreClient } from "@/lib/clients/core.client";

export interface TaskWithEvents {
  id: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  orchestratorId?: string | null;
  name: string;
  description?: string | null;
  status: TaskStatus;
  events: TaskEvent[];
}

interface ListTasksParams {
  status?: TaskStatus;
  orchestratorId?: string;
  cursor?: string | null;
  limit?: number;
}

interface CreateTaskInput {
  name: string;
  description: string | null;
  orchestratorId: string | null;
}

interface PatchTaskInput {
  name?: string;
  description?: string | null;
  orchestratorId?: string | null;
}

interface CreateTaskEventInput {
  status?: TaskStatus;
  comment?: string;
}

function buildQuery(params: ListTasksParams): string {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.orchestratorId) query.set("orchestratorId", params.orchestratorId);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", params.limit.toString());
  const queryString = query.toString();
  return queryString ? `?${queryString}` : "";
}

export const taskService = (() => {
  async function listTasks(params: ListTasksParams = {}) {
    const json: CoreApiResponse<TaskWithEvents[]> = await coreClient.request(
      `/v1/tasks${buildQuery(params)}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );
    return {
      tasks: json.data ?? [],
      pagination: json.meta?.pagination ?? null,
    };
  }

  async function getTaskById(taskId: string) {
    try {
      const json: CoreApiResponse<TaskWithEvents> = await coreClient.request(
        `/v1/tasks/${encodeURIComponent(taskId)}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );
      return json.data ?? null;
    } catch {
      return null;
    }
  }

  async function createTask(input: CreateTaskInput) {
    const json: CoreApiResponse<TaskWithEvents> = await coreClient.request(
      "/v1/tasks",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      },
    );

    if (!json.data) {
      throw new Error("Failed to create task");
    }

    return json.data;
  }

  async function createTaskEvent(taskId: string, input: CreateTaskEventInput) {
    const json: CoreApiResponse<TaskEvent> = await coreClient.request(
      `/v1/tasks/${encodeURIComponent(taskId)}/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      },
    );

    if (!json.data) {
      throw new Error("Failed to create task event");
    }

    return json.data;
  }

  async function patchTask(taskId: string, input: PatchTaskInput) {
    const json: CoreApiResponse<TaskWithEvents> = await coreClient.request(
      `/v1/tasks/${encodeURIComponent(taskId)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      },
    );

    if (!json.data) {
      throw new Error("Failed to update task");
    }

    return json.data;
  }

  async function deleteTask(taskId: string) {
    const json: CoreApiResponse<TaskWithEvents> = await coreClient.request(
      `/v1/tasks/${encodeURIComponent(taskId)}`,
      {
        method: "DELETE",
      },
    );

    if (!json.data) {
      throw new Error("Failed to delete task");
    }

    return json.data;
  }

  return {
    listTasks,
    getTaskById,
    createTask,
    createTaskEvent,
    patchTask,
    deleteTask,
  };
})();
