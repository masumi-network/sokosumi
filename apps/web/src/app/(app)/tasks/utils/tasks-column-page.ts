import "server-only";

import { TaskStatus } from "@sokosumi/utils";
import type { TasksScope } from "@/app/tasks/utils/tasks-filters";
import type { Coworker } from "@/lib/clients/generated/core";
import { taskService } from "@/lib/services/task.service";
import type { CoreAgentDto } from "@/lib/types/core-dto";
import type { KanbanColumnId, TaskWithCoworker } from "@/lib/types/task";
import { getColumnListQueryOptions } from "@/lib/utils/task-column";
import { mapTaskToTaskWithCoworker } from "@/lib/utils/task-transformer";

type ColumnCursor = string | null;

interface GetTasksColumnPageParams {
  columnId: KanbanColumnId;
  cursor: ColumnCursor;
  limit: number;
  scope: TasksScope;
  coworkerId: string | null;
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
  coworkerId,
  status,
  projectId,
  coworkersById,
  agentsById,
}: GetTasksColumnPageParams): Promise<GetTasksColumnPageResult> {
  const { statuses, pendingApproval, includeParkedReady } =
    getColumnListQueryOptions(columnId, status);

  if (statuses.length === 0) {
    return {
      tasks: [],
      nextCursor: null,
    };
  }

  const result = await taskService.listTasks({
    status: statuses,
    pendingApproval,
    includeParkedReady,
    scope,
    coworkerId: coworkerId ?? undefined,
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
