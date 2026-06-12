import "server-only";

import type { TaskStatus } from "@sokosumi/utils";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

/** A task row in the admin task list. */
export interface AdminTaskListItem {
  id: string;
  name: string;
  status: TaskStatus;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
  };
  /** Null for tasks in a personal workspace. */
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

export interface AdminTaskListPage {
  tasks: AdminTaskListItem[];
  total: number;
  nextCursor: string | null;
}

export interface ListAdminTasksParams {
  query?: string;
  cursor?: string;
  limit?: number;
}

export const adminTaskService = {
  async listTasks(
    params: ListAdminTasksParams = {},
  ): Promise<AdminTaskListPage> {
    const result = await coreClient.listAdminTasks(params);

    return {
      tasks: result.data.map((task) => ({
        id: task.id,
        name: task.name,
        status: task.status,
        createdAt: task.createdAt,
        user: task.user,
        organization: task.organization,
      })),
      total: result.meta.pagination.total,
      nextCursor: result.meta.pagination.nextCursor,
    };
  },

  async getTask(taskId: string): Promise<AdminTaskListItem | null> {
    try {
      const result = await coreClient.getAdminTask(taskId);

      return {
        id: result.data.id,
        name: result.data.name,
        status: result.data.status,
        createdAt: result.data.createdAt,
        user: result.data.user,
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
