import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  DeveloperCoworkerRef,
  DeveloperTaskListItem,
  Task,
} from "@/lib/clients/generated/core/types.gen";
import type { TaskStatus } from "@/lib/types/core-dto";

interface DeveloperTaskOwner {
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
  owner: DeveloperTaskOwner;
  /** Null for tasks in a personal workspace. */
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

/** Full task payload plus owner/organization context for developer views. */
export interface DeveloperTaskDetail {
  task: Task;
  owner: DeveloperTaskOwner;
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
    owner: task.owner,
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
        owner: result.data.owner,
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
