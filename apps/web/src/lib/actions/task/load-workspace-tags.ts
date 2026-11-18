"use server";

import { taskService } from "@/lib/services/task.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

import { type TaskTagSnapshot, taskTagSnapshot } from "./task-write-input";

export type { TaskTagSnapshot } from "./task-write-input";

export const loadTaskWorkspaceTags = withSession<
  AuthenticatedRequest & { taskId: string },
  TaskTagSnapshot | null
>(async ({ taskId }) => {
  const task = await taskService.getTaskById(taskId);
  return task ? taskTagSnapshot(task) : null;
});
