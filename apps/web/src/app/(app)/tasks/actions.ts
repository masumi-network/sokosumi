"use server";

import { getTranslations } from "next-intl/server";
import type { KanbanColumnId } from "@/app/tasks/types/task-board";
import { buildAgentNameById } from "@/app/tasks/utils/agent-names";
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
import { getAgentResolvedIcon } from "@/lib/helpers/agent";
import { agentService } from "@/lib/services/agent.service";
import { coworkerService } from "@/lib/services/coworker.service";
import { designMdService } from "@/lib/services/design-md.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { taskService } from "@/lib/services/task.service";

import { getTasksColumnPage } from "./utils/tasks-column-page";
import { getTasksListPage } from "./utils/tasks-list-page";

interface LoadMoreTasksColumnParams {
  columnId: KanbanColumnId;
  cursor: string | null;
  scope: TasksScope | null;
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  status: Task["status"] | null;
  projectId: string | null;
}

interface LoadMoreTasksListParams {
  cursor: string | null;
  scope: TasksScope | null;
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  status: Task["status"] | null;
  projectId: string | null;
}

export async function loadMoreTasksColumn({
  columnId,
  cursor,
  scope,
  assigneeId,
  assigneeSokoBotId,
  status,
  projectId,
}: LoadMoreTasksColumnParams) {
  const [session, coworkers, ownerBot, t] = await Promise.all([
    getSession(),
    coworkerService.listCoworkers("tasks").catch(() => []),
    sokoBotService.getMine().catch(() => null),
    getTranslations("App.Tasks"),
  ]);

  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const sanitizedScope = sanitizeTasksScopeInput(scope, activeOrganizationId);

  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const ownerSokoBotId = ownerBot?.id ?? null;
  const sanitizedAssigneeId =
    assigneeId && coworkersById.has(assigneeId) && assigneeId !== ownerSokoBotId
      ? assigneeId
      : null;
  const sanitizedAssigneeSokoBotId =
    assigneeSokoBotId && ownerSokoBotId && assigneeSokoBotId === ownerSokoBotId
      ? assigneeSokoBotId
      : null;
  const sanitizedStatus = sanitizeTasksStatusInput(status);
  const sanitizedProjectId = sanitizeProjectIdFilterInput(projectId);
  const page = await getTasksColumnPage({
    columnId,
    cursor,
    limit: TASKS_COLUMN_PAGE_LIMIT,
    scope: sanitizedScope,
    assigneeId: sanitizedAssigneeId,
    assigneeSokoBotId: sanitizedAssigneeSokoBotId,
    status: sanitizedStatus,
    projectId: sanitizedProjectId,
    coworkersById,
    personalAssistantFallback: t("personalAssistant"),
  });

  return {
    tasks: page.tasks,
    nextCursor: page.nextCursor,
  };
}

export async function loadMoreTasksList({
  cursor,
  scope,
  assigneeId,
  assigneeSokoBotId,
  status,
  projectId,
}: LoadMoreTasksListParams) {
  const [session, coworkers, ownerBot, t] = await Promise.all([
    getSession(),
    coworkerService.listCoworkers("tasks").catch(() => []),
    sokoBotService.getMine().catch(() => null),
    getTranslations("App.Tasks"),
  ]);

  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const sanitizedScope = sanitizeTasksScopeInput(scope, activeOrganizationId);

  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const ownerSokoBotId = ownerBot?.id ?? null;
  const sanitizedAssigneeId =
    assigneeId && coworkersById.has(assigneeId) && assigneeId !== ownerSokoBotId
      ? assigneeId
      : null;
  const sanitizedAssigneeSokoBotId =
    assigneeSokoBotId && ownerSokoBotId && assigneeSokoBotId === ownerSokoBotId
      ? assigneeSokoBotId
      : null;
  const sanitizedStatus = sanitizeTasksStatusInput(status);
  const sanitizedProjectId = sanitizeProjectIdFilterInput(projectId);
  const page = await getTasksListPage({
    cursor,
    limit: TASKS_COLUMN_PAGE_LIMIT,
    scope: sanitizedScope,
    assigneeId: sanitizedAssigneeId,
    assigneeSokoBotId: sanitizedAssigneeSokoBotId,
    status: sanitizedStatus,
    projectId: sanitizedProjectId,
    coworkersById,
    personalAssistantFallback: t("personalAssistant"),
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
  const [session, coworkers] = await Promise.all([
    getSession(),
    coworkerService.listCoworkers().catch(() => []),
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
  const { jobs, agentPreviewById } = await mapJobsToTasksViewData({
    jobs: jobsPage.jobs,
    coworkersById,
  });

  return {
    jobs,
    nextCursor: jobsPage.pagination?.nextCursor ?? null,
    agentPreviewById,
  };
}

export async function loadJobsTabData(
  scope: TasksScope | null,
  agentId: string | null,
  jobStatus: string | null,
  projectId: string | null,
) {
  const session = await getSession();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const sanitizedScope = sanitizeTasksScopeInput(scope, activeOrganizationId);
  const sanitizedAgentId = sanitizeJobAgentIdForPersistedFilter(agentId);
  const sanitizedJobStatus = sanitizeAgentJobStatusInput(jobStatus);
  const sanitizedProjectId = sanitizeProjectIdFilterInput(projectId);

  const [coworkers, agents, jobsPage] = await Promise.all([
    coworkerService.listCoworkers().catch(() => []),
    agentService.getAvailableAgentsWithCreditsPrice(),
    taskService.listJobs({
      scope: sanitizedScope,
      agentId: sanitizedAgentId ?? undefined,
      status: sanitizedJobStatus ?? undefined,
      projectId: sanitizedProjectId ?? undefined,
      cursor: null,
      limit: 20,
    }),
  ]);

  const agentNameById = buildAgentNameById(agents);
  const jobAgentOptions = agents.map((agent) => ({
    id: agent.id,
    name: agentNameById.get(agent.id) ?? agent.name,
    image: getAgentResolvedIcon(agent),
  }));

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
    jobAgentOptions,
  };
}

export async function loadCreateTaskModalData() {
  const session = await getSession();
  const [agents, designMdAttachment] = await Promise.all([
    agentService.getAvailableAgentsWithCreditsPrice(),
    session?.user.id ? designMdService.resolveEffectiveDesignMd() : null,
  ]);

  return {
    agentNameById: Object.fromEntries(buildAgentNameById(agents)),
    designMdAttachment,
  };
}
