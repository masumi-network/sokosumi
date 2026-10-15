import "server-only";

import type { Task } from "@sokosumi/core-client";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type { TaskStatus } from "@/lib/types/core-dto";

interface AdminTaskResponsibleUser {
  id: string;
  name: string;
  email: string;
}

/** A task row in the admin task list. */
export interface AdminTaskListItem {
  id: string;
  name: string;
  status: TaskStatus;
  createdAt: Date;
  /** The responsible person; null when nobody is responsible. */
  responsibleUser: AdminTaskResponsibleUser | null;
  /** Null for tasks in a personal workspace. */
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

/** Full task payload plus responsible person and organization context for admin views. */
export interface AdminTaskDetail {
  task: Task;
  /** The responsible person; null when nobody is responsible. */
  responsibleUser: AdminTaskResponsibleUser | null;
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
        responsibleUser: task.responsibleUser,
        organization: task.organization,
      })),
      total: result.meta.pagination.total,
      nextCursor: result.meta.pagination.nextCursor,
    };
  },

  async getTask(taskId: string): Promise<AdminTaskDetail | null> {
    try {
      const result = await coreClient.getAdminTask(taskId);

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
