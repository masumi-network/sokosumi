import "server-only";

import type { Coworker } from "@sokosumi/core-client";
import { TaskStatus } from "@sokosumi/core-client";
import type {
  KanbanColumnId,
  TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import { getColumnListQueryOptions } from "@/app/tasks/utils/task-column";
import type { TasksSort } from "@/app/tasks/utils/task-sort";
import { mapTaskToTaskWithCoworker } from "@/app/tasks/utils/task-view-model";
import {
  getTaskTagQuery,
  stuckCutoff,
  type TasksScope,
  type TasksVisibilityFilter,
  tasksQueryScope,
} from "@/app/tasks/utils/tasks-filters";
import { taskService } from "@/lib/services/task.service";
import type { CoreAgentDto } from "@/lib/types/core-dto";

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
  visibility: TasksVisibilityFilter;
  tag?: string;
  stuck?: boolean;
  needsMe?: boolean;
  mentions?: boolean;
  sort?: TasksSort;
  subtasks?: boolean;
  coworkersById: Map<string, Coworker>;
  personalAssistantFallback: string;
}

interface GetTasksColumnPageResult {
  tasks: TaskWithCoworker[];
  nextCursor: ColumnCursor;
  /** Every Task in the column under these filters, loaded or not. */
  total: number;
}

const NO_AGENTS = new Map<string, CoreAgentDto>();

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
  visibility,
  tag,
  stuck = false,
  needsMe = false,
  mentions = false,
  sort,
  subtasks = false,
  coworkersById,
  personalAssistantFallback,
}: GetTasksColumnPageParams): Promise<GetTasksColumnPageResult> {
  const { statuses } = getColumnListQueryOptions(
    columnId,
    status,
    stuck,
    needsMe,
  );

  if (statuses.length === 0) {
    return {
      tasks: [],
      nextCursor: null,
      total: 0,
    };
  }

  const result = await taskService.listTasks({
    status: statuses,
    // Mine: the reader owns the Task or is its assignee.
    scope: tasksQueryScope(scope, { needsMe, mentions }),
    ...(mentions ? { unansweredMention: true } : {}),
    ...(sort ? { sort } : {}),
    ...(subtasks ? { includeSubtasks: true } : {}),
    assigneeId: assigneeId ?? undefined,
    assigneeSokoBotId: assigneeSokoBotId ?? undefined,
    assigneeUserId: assigneeUserId ?? undefined,
    projectId: projectId ?? undefined,
    ...(visibility ? { visibility } : {}),
    ...getTaskTagQuery(tag),
    ...(stuck ? { statusBefore: stuckCutoff(new Date()) } : {}),
    cursor,
    limit,
  });
  // A board card shows no description, so the board neither looks up the
  // agents a description mentions (one Core read each) nor sends its text.
  const tasks = result.tasks.map((task) => ({
    ...mapTaskToTaskWithCoworker(
      task,
      coworkersById,
      NO_AGENTS,
      personalAssistantFallback,
    ),
    descriptionPlain: null,
  }));

  return {
    tasks,
    nextCursor: result.pagination?.nextCursor ?? null,
    total: result.pagination?.total ?? tasks.length,
  };
}
