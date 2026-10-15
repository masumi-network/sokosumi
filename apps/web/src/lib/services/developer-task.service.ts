import "server-only";

import type {
  DeveloperCoworkerRef,
  DeveloperTaskListItem,
  Task,
} from "@sokosumi/core-client";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type { TaskStatus } from "@/lib/types/core-dto";

interface DeveloperTaskResponsibleUser {
  id: string;
  name: string;
  email: string;
}

/** A task row in the developer owned-coworker task list. */
export interface DeveloperTaskListRow {
  id: string;
  name: string;
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
  assignee: DeveloperCoworkerRef;
  creatorCoworker: DeveloperCoworkerRef;
  /** The responsible person; null when nobody is responsible. */
  responsibleUser: DeveloperTaskResponsibleUser | null;
  /** Null for tasks in a personal workspace. */
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

/** Full task payload plus responsible person and organization context for developer views. */
export interface DeveloperTaskDetail {
  task: Task;
  /** The responsible person; null when nobody is responsible. */
  responsibleUser: DeveloperTaskResponsibleUser | null;
  /** Null for tasks in a personal workspace. */
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

export interface DeveloperTaskListPage {
  tasks: DeveloperTaskListRow[];
  total: number;
  nextCursor: string | null;
}

export interface ListDeveloperTasksParams {
  coworkerId?: string;
  cursor?: string;
  limit?: number;
}

function mapListItem(task: DeveloperTaskListItem): DeveloperTaskListRow {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    assignee: task.assignee,
    creatorCoworker: task.creatorCoworker,
    responsibleUser: task.responsibleUser,
    organization: task.organization,
  };
}

export const developerTaskService = {
  async listTasks(
    params: ListDeveloperTasksParams = {},
  ): Promise<DeveloperTaskListPage> {
    const result = await coreClient.listDeveloperOwnedCoworkerTasks(params);

    return {
      tasks: result.data.map(mapListItem),
      total: result.meta.pagination.total,
      nextCursor: result.meta.pagination.nextCursor,
    };
  },

  async getTask(taskId: string): Promise<DeveloperTaskDetail | null> {
    try {
      const result = await coreClient.getDeveloperOwnedCoworkerTask(taskId);

      return {
        task: result.data.task,
        responsibleUser: result.data.responsibleUser,
        organization: result.data.organization,
      };
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }
      throw error;
    }
  },
};
