"use server";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
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
import {
  TASK_SCHEDULE_OCCURRENCE_PAGE_LIMIT,
  TASKS_COLUMN_PAGE_LIMIT,
} from "@/app/tasks/utils/tasks-pagination";
import { getSession } from "@/lib/auth/auth.server";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import type {
  Task,
  TaskScheduleOccurrence,
  TaskScheduleOccurrenceView,
} from "@/lib/clients/generated/core";
import { getAgentResolvedIcon } from "@/lib/helpers/agent";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { agentService } from "@/lib/services/agent.service";
import { coworkerService } from "@/lib/services/coworker.service";
import { designMdService } from "@/lib/services/design-md.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { taskService } from "@/lib/services/task.service";
import { taskScheduleService } from "@/lib/services/task-schedule.service";
import { listTaskAssigneeMemberOptions } from "./utils/task-assignee-members";
import { listTaskAssigneeOptions } from "./utils/task-assignee-options";
import { getTasksColumnPage } from "./utils/tasks-column-page";
import { getTasksListPage } from "./utils/tasks-list-page";

interface LoadMoreTasksColumnParams {
  columnId: KanbanColumnId;
  cursor: string | null;
  scope: TasksScope | null;
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  assigneeUserId: string | null;
  status: Task["status"] | null;
  projectId: string | null;
}

interface LoadMoreTasksListParams {
  cursor: string | null;
  scope: TasksScope | null;
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  assigneeUserId: string | null;
  status: Task["status"] | null;
  projectId: string | null;
}

async function sanitizeAssigneeUserId(
  assigneeUserId: string | null,
  activeOrganizationId: string | null,
): Promise<string | null> {
  if (!assigneeUserId) return null;
  const memberOptions =
    await listTaskAssigneeMemberOptions(activeOrganizationId);
  return memberOptions.some((member) => member.id === assigneeUserId)
    ? assigneeUserId
    : null;
}

export async function loadMoreTasksColumn({
  columnId,
  cursor,
  scope,
  assigneeId,
  assigneeSokoBotId,
  assigneeUserId,
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
  const sanitizedAssigneeUserId = await sanitizeAssigneeUserId(
    assigneeUserId,
    activeOrganizationId,
  );
  const sanitizedStatus = sanitizeTasksStatusInput(status);
  const sanitizedProjectId = sanitizeProjectIdFilterInput(projectId);
  const page = await getTasksColumnPage({
    columnId,
    cursor,
    limit: TASKS_COLUMN_PAGE_LIMIT,
    scope: sanitizedScope,
    assigneeId: sanitizedAssigneeId,
    assigneeSokoBotId: sanitizedAssigneeSokoBotId,
    assigneeUserId: sanitizedAssigneeUserId,
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
  assigneeUserId,
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
  const sanitizedAssigneeUserId = await sanitizeAssigneeUserId(
    assigneeUserId,
    activeOrganizationId,
  );
  const sanitizedStatus = sanitizeTasksStatusInput(status);
  const sanitizedProjectId = sanitizeProjectIdFilterInput(projectId);
  const page = await getTasksListPage({
    cursor,
    limit: TASKS_COLUMN_PAGE_LIMIT,
    scope: sanitizedScope,
    assigneeId: sanitizedAssigneeId,
    assigneeSokoBotId: sanitizedAssigneeSokoBotId,
    assigneeUserId: sanitizedAssigneeUserId,
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

interface LoadMoreTaskScheduleOccurrencesParams {
  taskId: string;
  view: TaskScheduleOccurrenceView;
  cursor: string;
}

/**
 * A cursor is keyed to the schedule revision it was minted at, so Core rejects
 * it as `schedule_cursor_stale` once the series changes. That is reported as a
 * state, not an error: the client refreshes the route and starts over from the
 * server-rendered first page.
 */
export type LoadMoreTaskScheduleOccurrencesResult =
  | {
      status: "ok";
      occurrences: TaskScheduleOccurrence[];
      nextCursor: string | null;
    }
  | { status: "stale" };

export async function loadMoreTaskScheduleOccurrences({
  taskId,
  view,
  cursor,
}: LoadMoreTaskScheduleOccurrencesParams): Promise<LoadMoreTaskScheduleOccurrencesResult> {
  try {
    const page = await taskScheduleService.listOccurrences(taskId, {
      view,
      cursor,
      limit: TASK_SCHEDULE_OCCURRENCE_PAGE_LIMIT,
    });

    return {
      status: "ok",
      occurrences: page.occurrences,
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (
      error instanceof CoreApiRequestError &&
      error.kind === CORE_API_ERROR_KINDS.SCHEDULE_CURSOR_STALE
    ) {
      return { status: "stale" };
    }

    throw error;
  }
}

async function loadCreateTaskData(userId: string | null) {
  const [agents, designMdAttachment] = await Promise.all([
    agentService.getAvailableAgentsWithCreditsPrice(),
    userId ? designMdService.resolveEffectiveDesignMd() : null,
  ]);

  return {
    agentNameById: Object.fromEntries(buildAgentNameById(agents)),
    designMdAttachment,
  };
}

export async function loadCreateTaskModalData() {
  const session = await getSession();
  return loadCreateTaskData(session?.user.id ?? null);
}

/**
 * Everything the New Task wizard opened from the sidebar needs, in one round
 * trip: assignees and projects of the active workspace plus the create data
 * the modal would otherwise load itself.
 */
export async function loadNewTaskWizardOptions() {
  const session = await getSession();
  const [coworkerOptions, projectOptions, createData] = await Promise.all([
    listTaskAssigneeOptions(session?.session.activeOrganizationId ?? null),
    getProjectFilterOptions(),
    loadCreateTaskData(session?.user.id ?? null),
  ]);

  return { coworkerOptions, projectOptions, ...createData };
}
