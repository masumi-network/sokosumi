"use server";

import type { KanbanColumnId } from "@/app/tasks/types/task-board";
import {
  sanitizeAgentJobStatusInput,
  sanitizeJobAgentIdForPersistedFilter,
} from "@/app/tasks/utils/jobs-filters";
import { mapJobsToTasksViewData } from "@/app/tasks/utils/jobs-view-data";
import {
  sanitizeProjectIdFilterInput,
  sanitizeTasksScopeInput,
  sanitizeTasksStatusInput,
  TasksScope,
} from "@/app/tasks/utils/tasks-filters";
import { TASKS_COLUMN_PAGE_LIMIT } from "@/app/tasks/utils/tasks-pagination";
import { getSession } from "@/lib/auth/auth.server";
import type { Task } from "@/lib/clients/generated/core";
import { agentService } from "@/lib/services/agent.service";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";

import { getTasksColumnPage } from "./utils/tasks-column-page";

interface LoadMoreTasksColumnParams {
  columnId: KanbanColumnId;
  cursor: string | null;
  scope: TasksScope | null;
  assigneeId: string | null;
  status: Task["status"] | null;
  projectId: string | null;
}

export async function loadMoreTasksColumn({
  columnId,
  cursor,
  scope,
  assigneeId,
  status,
  projectId,
}: LoadMoreTasksColumnParams) {
  const [session, coworkers, agents] = await Promise.all([
    getSession(),
    coworkerService.listCoworkers("tasks").catch(() => []),
    agentService.getAvailableAgentsWithCreditsPrice(),
  ]);

  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const sanitizedScope = sanitizeTasksScopeInput(scope, activeOrganizationId);

  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const sanitizedAssigneeId =
    assigneeId && coworkersById.has(assigneeId) ? assigneeId : null;
  const sanitizedStatus = sanitizeTasksStatusInput(status);
  const sanitizedProjectId = sanitizeProjectIdFilterInput(projectId);
  const page = await getTasksColumnPage({
    columnId,
    cursor,
    limit: TASKS_COLUMN_PAGE_LIMIT,
    scope: sanitizedScope,
    assigneeId: sanitizedAssigneeId,
    status: sanitizedStatus,
    projectId: sanitizedProjectId,
    coworkersById,
    agentsById,
  });

  return {
    tasks: page.tasks,
    nextCursor: page.nextCursor,
  };
}

export async function loadMoreJobs(
  cursor: string | null,
  scope: TasksScope | null,
  agentId: string | null,
  jobStatus: string | null,
  projectId: string | null,
) {
  const [session, coworkers, agents] = await Promise.all([
    getSession(),
    coworkerService.listCoworkers().catch(() => []),
    agentService.getAvailableAgentsWithCreditsPrice(),
  ]);
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const sanitizedScope = sanitizeTasksScopeInput(scope, activeOrganizationId);
  const sanitizedAgentId = sanitizeJobAgentIdForPersistedFilter(agentId);
  const sanitizedJobStatus = sanitizeAgentJobStatusInput(jobStatus);
  const sanitizedProjectId = sanitizeProjectIdFilterInput(projectId);
  const jobsPage = await taskService.listJobs({
    scope: sanitizedScope,
    agentId: sanitizedAgentId ?? undefined,
    status: sanitizedJobStatus ?? undefined,
    projectId: sanitizedProjectId ?? undefined,
    cursor,
    limit: 20,
  });

  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const knownAgentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const { jobs, agentPreviewById } = await mapJobsToTasksViewData({
    jobs: jobsPage.jobs,
    coworkersById,
    knownAgentsById,
  });

  return {
    jobs,
    nextCursor: jobsPage.pagination?.nextCursor ?? null,
    agentPreviewById,
  };
}
