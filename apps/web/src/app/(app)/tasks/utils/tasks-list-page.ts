import "server-only";

import type { Coworker } from "@sokosumi/core-client";
import { TaskStatus } from "@sokosumi/core-client";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { resolveMentionedAgentsById } from "@/app/tasks/utils/mentioned-agents";
import {
  COLUMN_TASK_STATUSES,
  NEEDS_PERSON_COLUMN_ID,
  WAITING_TASK_STATUSES,
} from "@/app/tasks/utils/task-column";
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
  tag?: string;
  stuck?: boolean;
  needsMe?: boolean;
  mentions?: boolean;
  sort?: TasksSort;
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
  tag,
  stuck = false,
  needsMe = false,
  mentions = false,
  sort,
  coworkersById,
  personalAssistantFallback,
}: GetTasksListPageParams): Promise<GetTasksListPageResult> {
  // Stuck and Needs me each allow a set of statuses. Both on: only the
  // statuses in both sets.
  const allowed = [
    ...(stuck ? [WAITING_TASK_STATUSES] : []),
    ...(needsMe ? [COLUMN_TASK_STATUSES[NEEDS_PERSON_COLUMN_ID]] : []),
  ];
  const statuses =
    allowed.length > 0
      ? allowed
          .reduce((kept, set) => kept.filter((one) => set.includes(one)))
          .filter((one) => status === null || one === status)
      : status;
  // A status that cannot wait, under Stuck: nothing to list.
  if (Array.isArray(statuses) && statuses.length === 0) {
    return { tasks: [], nextCursor: null };
  }
  const result = await taskService.listTasks({
    status: statuses ?? undefined,
    scope: tasksQueryScope(scope, { needsMe, mentions }),
    ...(mentions ? { unansweredMention: true } : {}),
    ...(sort ? { sort } : {}),
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
