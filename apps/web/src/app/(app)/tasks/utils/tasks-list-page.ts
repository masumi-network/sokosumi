import "server-only";

import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { resolveMentionedAgentsById } from "@/app/tasks/utils/mentioned-agents";
import { mapTaskToTaskWithCoworker } from "@/app/tasks/utils/task-view-model";
import type { TasksScope } from "@/app/tasks/utils/tasks-filters";
import type { Coworker } from "@/lib/clients/generated/core";
import { TaskStatus } from "@/lib/clients/generated/core";
import { taskService } from "@/lib/services/task.service";

type ListCursor = string | null;

interface GetTasksListPageParams {
  cursor: ListCursor;
  limit: number;
  scope: TasksScope;
  assigneeId: string | null;
  assigneeOrchestratorId: string | null;
  status: TaskStatus | null;
  projectId: string | null;
  coworkersById: Map<string, Coworker>;
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
  assigneeOrchestratorId,
  status,
  projectId,
  coworkersById,
}: GetTasksListPageParams): Promise<GetTasksListPageResult> {
  const result = await taskService.listTasks({
    status: status ?? undefined,
    scope,
    assigneeId: assigneeId ?? undefined,
    assigneeOrchestratorId: assigneeOrchestratorId ?? undefined,
    projectId: projectId ?? undefined,
    cursor,
    limit,
  });
  const agentsById = await resolveMentionedAgentsById(
    result.tasks.map((task) => task.description),
  );
  const tasks = result.tasks.map((task) =>
    mapTaskToTaskWithCoworker(task, coworkersById, agentsById),
  );

  return {
    tasks,
    nextCursor: result.pagination?.nextCursor ?? null,
  };
}
