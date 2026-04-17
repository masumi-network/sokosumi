"use server";

import type { TaskStatus } from "@sokosumi/database";

import { mapJobsToTasksViewData } from "@/app/tasks/utils/jobs-view-data";
import type { TasksScope } from "@/app/tasks/utils/tasks-filters";
import { TASKS_COLUMN_PAGE_LIMIT } from "@/app/tasks/utils/tasks-pagination";
import { agentService } from "@/lib/services/agent.service";
import { coworkerService } from "@/lib/services/coworker.service";
import { userService } from "@/lib/services/user.service";
import type { KanbanColumnId } from "@/lib/types/task";

import { getTasksColumnPage } from "./utils/tasks-column-page";

interface LoadMoreTasksColumnParams {
  columnId: KanbanColumnId;
  cursor: string | null;
  scope: TasksScope;
  coworkerId: string | null;
  status: TaskStatus | null;
}

export async function loadMoreTasksColumn({
  columnId,
  cursor,
  scope,
  coworkerId,
  status,
}: LoadMoreTasksColumnParams) {
  const [coworkers, agents] = await Promise.all([
    coworkerService.listCoworkers("tasks"),
    agentService.getAvailableAgentsWithCreditsPrice(),
  ]);

  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const sanitizedCoworkerId =
    coworkerId && coworkersById.has(coworkerId) ? coworkerId : null;
  const page = await getTasksColumnPage({
    columnId,
    cursor,
    limit: TASKS_COLUMN_PAGE_LIMIT,
    scope,
    coworkerId: sanitizedCoworkerId,
    status,
    coworkersById,
    agentsById,
  });

  return {
    tasks: page.tasks,
    nextCursor: page.nextCursor,
  };
}

export async function loadMoreJobs(cursor: string | null) {
  const [coworkers, jobsPage] = await Promise.all([
    coworkerService.listCoworkers(),
    userService.listMyJobsForActiveContextPaginated({
      cursor,
      limit: 20,
    }),
  ]);

  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const { jobs, agentPreviewById } = await mapJobsToTasksViewData({
    jobs: jobsPage.jobs,
    coworkersById,
  });

  return {
    jobs,
    nextCursor: jobsPage.nextCursor,
    agentPreviewById,
  };
}
