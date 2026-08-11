import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  JobSummary,
  Task,
  TaskEvent,
  TaskLink,
  TaskLinkDeleted,
  TaskWorkspace,
  UserWritableTaskLinkRelation,
} from "@/lib/clients/generated/core";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { AgentJobStatus } from "@/lib/types/core-dto";

export interface TaskActivitySummary {
  awaitingInput: number;
  /** Which window the counts cover, so the caption can say so. */
  basis: "lastVisit" | "recent";
  completed: number;
  createdByOtherHumans: number;
  /** Server-owned window start; null means this is the user's first visit. */
  since: Date | null;
  /** Wall-clock minutes tasks spent RUNNING inside the window. */
  workedMinutes: number;
}

const EMPTY_TASK_ACTIVITY_SUMMARY: TaskActivitySummary = {
  awaitingInput: 0,
  basis: "recent",
  completed: 0,
  createdByOtherHumans: 0,
  since: null,
  workedMinutes: 0,
};

interface ListTasksParams {
  status?: TaskStatus | TaskStatus[];
  assigneeId?: string;
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
  assigneeId: string | null;
  projectId?: string | null;
  status?: Extract<TaskStatus, "DRAFT" | "READY">;
}

interface PatchTaskInput {
  name?: string;
  description?: string | null;
  assigneeId?: string | null;
  projectId?: string | null;
}

interface CreateTaskEventInput {
  status?: TaskStatus;
  comment?: string;
}

interface CreateTaskLinkInput {
  toTaskId: string;
  relation: UserWritableTaskLinkRelation;
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
      assigneeId: params.assigneeId,
      projectId: params.projectId,
      q: params.q,
      scope: params.scope,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
      sort: params.sort,
    });

    return {
      tasks: result.data ?? [],
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

  /**
   * Counts for the /chat landing. Never throws: the landing is a greeting, so
   * a Core hiccup should cost the sentence, not the page.
   */
  async function getActivitySummary(params: {
    scope?: "owned" | "workspace";
  }): Promise<TaskActivitySummary> {
    try {
      const result = await coreClient.getTasksSummary({
        scope: params.scope ?? "owned",
      });

      const data = result.data;
      if (!data) {
        return EMPTY_TASK_ACTIVITY_SUMMARY;
      }

      return {
        completed: data.completed,
        awaitingInput: data.awaitingInput,
        basis: data.basis,
        createdByOtherHumans: data.createdByOtherHumans,
        since: data.since ? new Date(data.since) : null,
        workedMinutes: data.workedMinutes,
      };
    } catch (error) {
      console.error("Failed to load task activity summary", error);
      return EMPTY_TASK_ACTIVITY_SUMMARY;
    }
  }

  return {
    getActivitySummary,
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
