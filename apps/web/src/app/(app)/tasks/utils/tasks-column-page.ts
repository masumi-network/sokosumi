import "server-only";

import type { AgentWithCreditsPrice } from "@sokosumi/database";
import { type TaskStatus } from "@sokosumi/database";

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
  memberId?: string | null;
  coworkerId?: string | null;
  agentId?: string | null;
  taskStatus?: TaskStatus | null;
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
  memberId = null,
  coworkerId = null,
  agentId = null,
  taskStatus = null,
  coworkersById,
  agentsById,
}: GetTasksColumnPageParams): Promise<GetTasksColumnPageResult> {
  const columnStatuses = COLUMN_TASK_STATUSES[columnId];
  const scopedStatuses = taskStatus
    ? columnStatuses.includes(taskStatus)
      ? [taskStatus]
      : []
    : columnStatuses;

  if (scopedStatuses.length === 0) {
    return {
      tasks: [],
      nextCursor: null,
    };
  }

  const result = await taskService.listTasks({
    status: scopedStatuses,
    memberId: memberId ?? undefined,
    coworkerId: coworkerId ?? undefined,
    agentId: agentId ?? undefined,
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
