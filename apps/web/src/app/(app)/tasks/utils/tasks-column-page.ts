import "server-only";

import type {
  KanbanColumnId,
  TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import { resolveMentionedAgentsById } from "@/app/tasks/utils/mentioned-agents";
import { getColumnListQueryOptions } from "@/app/tasks/utils/task-column";
import { mapTaskToTaskWithCoworker } from "@/app/tasks/utils/task-view-model";
import type { TasksScope } from "@/app/tasks/utils/tasks-filters";
import type { Coworker } from "@/lib/clients/generated/core";
import { TaskStatus } from "@/lib/clients/generated/core";
import { taskService } from "@/lib/services/task.service";

type ColumnCursor = string | null;

interface GetTasksColumnPageParams {
  columnId: KanbanColumnId;
  cursor: ColumnCursor;
  limit: number;
  scope: TasksScope;
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  assigneeUserId: string | null;
  status: TaskStatus | null;
  projectId: string | null;
  coworkersById: Map<string, Coworker>;
  personalAssistantFallback: string;
}

interface GetTasksColumnPageResult {
  tasks: TaskWithCoworker[];
  nextCursor: ColumnCursor;
}

export async function getTasksColumnPage({
  columnId,
  cursor,
  limit,
  scope,
  assigneeId,
  assigneeSokoBotId,
  assigneeUserId,
  status,
  projectId,
  coworkersById,
  personalAssistantFallback,
}: GetTasksColumnPageParams): Promise<GetTasksColumnPageResult> {
  const { statuses } = getColumnListQueryOptions(columnId, status);

  if (statuses.length === 0) {
    return {
      tasks: [],
      nextCursor: null,
    };
  }

  const result = await taskService.listTasks({
    status: statuses,
    scope,
    assigneeId: assigneeId ?? undefined,
    assigneeSokoBotId: assigneeSokoBotId ?? undefined,
    assigneeUserId: assigneeUserId ?? undefined,
    projectId: projectId ?? undefined,
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
