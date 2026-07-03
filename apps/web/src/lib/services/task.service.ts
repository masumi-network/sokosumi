import "server-only";

import { TaskStatus } from "@sokosumi/utils";
import { coreClient } from "@/lib/clients/core.client";
import type {
  JobSummary,
  Task,
  TaskEvent,
  TaskLink,
  TaskLinkDeleted,
  TaskLinkRelation,
  TaskWorkspace,
} from "@/lib/clients/generated/core/types.gen";
import type { AgentJobStatus } from "@/lib/types/core-dto";

interface ListTasksParams {
  status?: TaskStatus | TaskStatus[];
  coworkerId?: string;
  projectId?: string;
  q?: string;
  scope?: "workspace" | "owned";
  cursor?: string | null;
  limit?: number;
  sort?: "nextRunAt";
}

interface ListJobsParams {
  scope?: "workspace" | "owned";
  agentId?: string;
  projectId?: string;
  status?: AgentJobStatus;
  cursor?: string | null;
  limit?: number;
}

interface CreateTaskInput {
  name?: string;
  description: string | null;
  coworkerId: string | null;
  projectId?: string | null;
  status?: Extract<TaskStatus, "DRAFT" | "READY">;
}

interface PatchTaskInput {
  name?: string;
  description?: string | null;
  coworkerId?: string | null;
  projectId?: string | null;
}

interface CreateTaskEventInput {
  status?: TaskStatus;
  comment?: string;
}

interface CreateTaskLinkInput {
  toTaskId: string;
  relation: TaskLinkRelation;
  note?: string | null;
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
      projectId: params.projectId,
      q: params.q,
      scope: params.scope,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
      sort: params.sort,
    });

    return {
      tasks: result.data,
      pagination: result.meta?.pagination ?? null,
    };
  }

  async function listJobs(params: ListJobsParams = {}): Promise<{
    jobs: JobSummary[];
    pagination: {
      cursor: string | null;
      limit: number;
      total: number;
      nextCursor: string | null;
    } | null;
  }> {
    const result = await coreClient.getJobs({
      scope: params.scope,
      agentId: params.agentId,
      projectId: params.projectId,
      status: params.status,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    });

    return {
      jobs: result.data,
      pagination: result.meta?.pagination ?? null,
    };
  }

  async function getTaskById(taskId: string): Promise<Task | null> {
    try {
      const result = await coreClient.getTaskById(taskId);
      return result.data;
    } catch {
      return null;
    }
  }

  async function getTaskWorkspace(
    taskId: string,
  ): Promise<TaskWorkspace | null> {
    try {
      const result = await coreClient.getTaskWorkspace(taskId);
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

  async function listTaskLinks(taskId: string): Promise<TaskLink[]> {
    const result = await coreClient.getTaskLinks(taskId);
    return result.data;
  }

  async function createTaskLink(
    taskId: string,
    input: CreateTaskLinkInput,
  ): Promise<TaskLink> {
    const result = await coreClient.createTaskLink(taskId, input);

    if (!result.data) {
      throw new Error("Failed to create task link");
    }

    return result.data;
  }

  async function deleteTaskLink(
    taskId: string,
    linkId: string,
  ): Promise<TaskLinkDeleted> {
    const result = await coreClient.deleteTaskLink(taskId, linkId);

    if (!result.data) {
      throw new Error("Failed to delete task link");
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
    listJobs,
    listTasks,
    getTaskById,
    getTaskWorkspace,
    createTask,
    createTaskLink,
    createTaskEvent,
    deleteTaskLink,
    moveTaskToWorkspace,
    patchTask,
    listTaskLinks,
    deleteTask,
  };
})();
