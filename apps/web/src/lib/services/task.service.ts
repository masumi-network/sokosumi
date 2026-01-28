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

  return {
    listTasks,
    getTaskById,
  };
})();
