import "server-only";

import type { AgentWithCreditsPrice } from "@sokosumi/database";

import type { Coworker } from "@/lib/clients/generated/core";
import { taskService } from "@/lib/services/task.service";
import type { KanbanColumnId, TaskWithCoworker } from "@/lib/types/task";
import { COLUMN_TASK_STATUSES } from "@/lib/utils/task-column";
import { mapTaskToTaskWithCoworker } from "@/lib/utils/task-transformer";

type ColumnCursor = string | null;

interface GetTasksColumnPageParams {
  columnId: KanbanColumnId;
  cursor: ColumnCursor;
  limit: number;
  coworkersById: Map<string, Coworker>;
  agentsById: Map<string, AgentWithCreditsPrice>;
}

interface GetTasksColumnPageResult {
  tasks: TaskWithCoworker[];
  nextCursor: ColumnCursor;
}

export async function getTasksColumnPage({
  columnId,
  cursor,
  limit,
  coworkersById,
  agentsById,
}: GetTasksColumnPageParams): Promise<GetTasksColumnPageResult> {
  const result = await taskService.listTasks({
    status: COLUMN_TASK_STATUSES[columnId],
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
