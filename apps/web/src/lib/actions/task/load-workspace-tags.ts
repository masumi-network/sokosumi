"use server";

import type { Task } from "@sokosumi/core-client";
import { taskService } from "@/lib/services/task.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

export type TaskTagSnapshot = Required<
  Pick<Task, "workspaceTags" | "workspaceTagSuggestions">
>;

export const loadTaskWorkspaceTags = withSession<
  AuthenticatedRequest & { taskId: string },
  TaskTagSnapshot | null
>(async ({ taskId }) => {
  const task = await taskService.getTaskById(taskId);
  return task
    ? {
        workspaceTags: task.workspaceTags ?? [],
        workspaceTagSuggestions: task.workspaceTagSuggestions ?? [],
      }
    : null;
});
