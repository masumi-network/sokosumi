import "server-only";

import type {
  KanbanColumnId,
  TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import { getColumnListQueryOptions } from "@/app/tasks/utils/task-column";
import { mapTaskToTaskWithCoworker } from "@/app/tasks/utils/task-view-model";
import type { TasksScope } from "@/app/tasks/utils/tasks-filters";
import type { Coworker } from "@/lib/clients/generated/core";
import { TaskStatus } from "@/lib/clients/generated/core";
import { taskService } from "@/lib/services/task.service";
import type { CoreAgentDto } from "@/lib/types/core-dto";

type ColumnCursor = string | null;

interface GetTasksColumnPageParams {
  columnId: KanbanColumnId;
  cursor: ColumnCursor;
  limit: number;
  scope: TasksScope;
  assigneeId: string | null;
  status: TaskStatus | null;
  projectId: string | null;
  coworkersById: Map<string, Coworker>;
  agentsById: Map<string, CoreAgentDto>;
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
  status,
  projectId,
  coworkersById,
  agentsById,
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
    projectId: projectId ?? undefined,
    cursor,
    limit,
  });
  const tasks = result.tasks.map((task) =>
    mapTaskToTaskWithCoworker(task, coworkersById, agentsById),
  );

  return {
    tasks,
    nextCursor: result.pagination?.nextCursor ?? null,
  };
}
