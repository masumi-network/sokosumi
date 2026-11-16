import "server-only";

import type { Coworker } from "@sokosumi/core-client";
import { TaskStatus } from "@sokosumi/core-client";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { resolveMentionedAgentsById } from "@/app/tasks/utils/mentioned-agents";
import { WAITING_TASK_STATUSES } from "@/app/tasks/utils/task-column";
import { mapTaskToTaskWithCoworker } from "@/app/tasks/utils/task-view-model";
import {
  stuckCutoff,
  type TasksScope,
  type TasksVisibilityFilter,
} from "@/app/tasks/utils/tasks-filters";
import { taskService } from "@/lib/services/task.service";

type ListCursor = string | null;

interface GetTasksListPageParams {
  cursor: ListCursor;
  limit: number;
  scope: TasksScope;
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  assigneeUserId: string | null;
  status: TaskStatus | null;
  projectId: string | null;
  visibility: TasksVisibilityFilter;
  stuck?: boolean;
  coworkersById: Map<string, Coworker>;
  personalAssistantFallback: string;
}

interface GetTasksListPageResult {
  tasks: TaskWithCoworker[];
  nextCursor: ListCursor;
}

export async function getTasksListPage({
  cursor,
  limit,
  scope,
  assigneeId,
  assigneeSokoBotId,
  assigneeUserId,
  status,
  projectId,
  visibility,
  stuck = false,
  coworkersById,
  personalAssistantFallback,
}: GetTasksListPageParams): Promise<GetTasksListPageResult> {
  const statuses = stuck
    ? WAITING_TASK_STATUSES.filter(
        (waiting) => status === null || waiting === status,
      )
    : status;
  // A status that cannot wait, under Stuck: nothing to list.
  if (Array.isArray(statuses) && statuses.length === 0) {
    return { tasks: [], nextCursor: null };
  }
  const result = await taskService.listTasks({
    status: statuses ?? undefined,
    scope,
    assigneeId: assigneeId ?? undefined,
    assigneeSokoBotId: assigneeSokoBotId ?? undefined,
    assigneeUserId: assigneeUserId ?? undefined,
    projectId: projectId ?? undefined,
    ...(visibility ? { visibility } : {}),
    ...(stuck ? { statusBefore: stuckCutoff(new Date()) } : {}),
    cursor,
    limit,
  });
  const agentsById = await resolveMentionedAgentsById(
    result.tasks.map((task) => task.description),
  );
  const tasks = result.tasks.map((task) =>
    mapTaskToTaskWithCoworker(
      task,
      coworkersById,
      agentsById,
      personalAssistantFallback,
    ),
  );

  return {
    tasks,
    nextCursor: result.pagination?.nextCursor ?? null,
  };
}
