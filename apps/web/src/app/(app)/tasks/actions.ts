"use server";

import type { Task, TaskScheduleState } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";
import type { KanbanColumnId } from "@/app/tasks/types/task-board";
import { buildAgentNameById } from "@/app/tasks/utils/agent-names";
import {
  normalizeTaskSearch,
  pickTasksViewQuery,
  sanitizeProjectIdFilterInput,
  sanitizeTasksScopeInput,
  sanitizeTasksStatusInput,
  sanitizeTasksStuckInput,
  sanitizeTasksVisibilityInput,
  sanitizeTaskTagFilter,
  TasksScope,
} from "@/app/tasks/utils/tasks-filters";
import { TASKS_COLUMN_PAGE_LIMIT } from "@/app/tasks/utils/tasks-pagination";
import { getSession } from "@/lib/auth/auth.server";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { agentService } from "@/lib/services/agent.service";
import { coworkerService } from "@/lib/services/coworker.service";
import { designMdService } from "@/lib/services/design-md.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { taskService } from "@/lib/services/task.service";
import {
  type TaskSchedulesPage,
  taskScheduleService,
} from "@/lib/services/task-schedule.service";
import { listTaskAssigneeMemberOptions } from "./utils/task-assignee-members";
import { listTaskAssigneeOptions } from "./utils/task-assignee-options";
import { listTaskScheduleAssigneeOptions } from "./utils/task-schedule-assignee-options";
import {
  parseTaskScheduleStateFilter,
  TASK_SCHEDULES_PAGE_LIMIT,
} from "./utils/task-schedules-filters";
import { parseTasksSort } from "./utils/task-sort";
import { getTasksColumnPage } from "./utils/tasks-column-page";
import {
  TASKS_EXPORT_LIMIT,
  type TaskCsvRow,
  toTaskCsvRow,
} from "./utils/tasks-csv";
import { getTasksListPage } from "./utils/tasks-list-page";

interface TasksLoadMoreFilters {
  scope: TasksScope | null;
  assigneeId: string | null;
  assigneeSokoBotId: string | null;
  assigneeUserId: string | null;
  status: Task["status"] | null;
  projectId: string | null;
  visibility: Task["visibility"] | null;
  search?: string;
  tag?: string;
  stuck?: boolean;
  needsMe?: boolean;
  mentions?: boolean;
  sort?: string;
}

interface LoadMoreTasksColumnParams extends TasksLoadMoreFilters {
  columnId: KanbanColumnId;
  cursor: string | null;
}

interface LoadMoreTasksListParams extends TasksLoadMoreFilters {
  cursor: string | null;
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

async function loadSanitizedTasksPageFilters({
  scope,
  assigneeId,
  assigneeSokoBotId,
  assigneeUserId,
  status,
  projectId,
  visibility,
  tag,
  search,
  stuck,
  needsMe,
  mentions,
  sort,
}: TasksLoadMoreFilters) {
  const [session, coworkers, ownerBot, t] = await Promise.all([
    getSession(),
    coworkerService.listCoworkers("tasks").catch(() => []),
    sokoBotService.getMine().catch(() => null),
    getTranslations("App.Tasks"),
  ]);

  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const coworkersById = new Map(
    coworkers.map((coworker) => [coworker.id, coworker]),
  );
  const ownerSokoBotId = ownerBot?.id ?? null;

  return {
    scope: sanitizeTasksScopeInput(scope, activeOrganizationId),
    assigneeId:
      assigneeId &&
      coworkersById.has(assigneeId) &&
      assigneeId !== ownerSokoBotId
        ? assigneeId
        : null,
    assigneeSokoBotId:
      assigneeSokoBotId &&
      ownerSokoBotId &&
      assigneeSokoBotId === ownerSokoBotId
        ? assigneeSokoBotId
        : null,
    assigneeUserId: await sanitizeAssigneeUserId(
      assigneeUserId,
      activeOrganizationId,
    ),
    status: sanitizeTasksStatusInput(status),
    projectId: sanitizeProjectIdFilterInput(projectId),
    visibility: sanitizeTasksVisibilityInput(visibility, activeOrganizationId),
    search: normalizeTaskSearch(search),
    tag: sanitizeTaskTagFilter(tag),
    stuck: sanitizeTasksStuckInput(stuck),
    needsMe: sanitizeTasksStuckInput(needsMe),
    mentions: sanitizeTasksStuckInput(mentions),
    sort: parseTasksSort(sort),
    coworkersById,
    personalAssistantFallback: t("personalAssistant"),
  };
}

export async function loadMoreTasksColumn({
  columnId,
  cursor,
  ...filters
}: LoadMoreTasksColumnParams) {
  const page = await getTasksColumnPage({
    columnId,
    cursor,
    limit: TASKS_COLUMN_PAGE_LIMIT,
    ...(await loadSanitizedTasksPageFilters(filters)),
  });

  return {
    tasks: page.tasks,
    nextCursor: page.nextCursor,
  };
}

export async function loadMoreTasksList({
  cursor,
  ...filters
}: LoadMoreTasksListParams) {
  const page = await getTasksListPage({
    cursor,
    limit: TASKS_COLUMN_PAGE_LIMIT,
    ...(await loadSanitizedTasksPageFilters(filters)),
  });

  return {
    tasks: page.tasks,
    nextCursor: page.nextCursor,
  };
}

/**
 * Saves the reader's Tasks view. Only the view keys reach Core, whatever
 * the client sent.
 */
export async function saveTasksView(
  query: string,
  pageOrganizationId: string | null,
): Promise<boolean> {
  // Core saves to the session's workspace. Another tab can switch it after
  // this page loaded; then the view belongs to a different workspace.
  const session = await getSession();
  if ((session?.session.activeOrganizationId ?? null) !== pageOrganizationId) {
    return false;
  }
  await taskService.saveTasksViewQuery(
    pickTasksViewQuery(new URLSearchParams(query)),
  );
  return true;
}

/** Core's largest page. */
const TASKS_EXPORT_PAGE_LIMIT = 100;

/**
 * The Tasks that match the current filters, in the order shown, for a CSV
 * download. Stops at TASKS_EXPORT_LIMIT; `truncated` says more matched.
 */
export async function exportTasks(
  filters: TasksLoadMoreFilters,
): Promise<{ rows: TaskCsvRow[]; truncated: boolean }> {
  const pageFilters = await loadSanitizedTasksPageFilters(filters);
  const rows: TaskCsvRow[] = [];
  // Last updated moves a Task between pages when it changes mid-export.
  const seenIds = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await getTasksListPage({
      ...pageFilters,
      cursor,
      // One row past the limit tells a full export from a cut one.
      limit: Math.min(
        TASKS_EXPORT_PAGE_LIMIT,
        TASKS_EXPORT_LIMIT + 1 - rows.length,
      ),
    });
    for (const task of page.tasks) {
      if (seenIds.has(task.id)) continue;
      seenIds.add(task.id);
      rows.push(toTaskCsvRow(task));
    }
    cursor = page.nextCursor;
  } while (cursor && rows.length <= TASKS_EXPORT_LIMIT);

  return {
    rows: rows.slice(0, TASKS_EXPORT_LIMIT),
    truncated: rows.length > TASKS_EXPORT_LIMIT,
  };
}

/** Enough rows to show what the file looks like. */
const TASKS_EXPORT_PREVIEW_ROWS = 3;

/**
 * What Export as CSV would save, from one page of Tasks: how many match,
 * and the first few rows. The confirm dialog shows it before the full
 * export runs.
 */
export async function previewTasksExport(
  filters: TasksLoadMoreFilters,
): Promise<{ rows: TaskCsvRow[]; matched: number }> {
  const page = await getTasksListPage({
    ...(await loadSanitizedTasksPageFilters(filters)),
    cursor: null,
    limit: TASKS_EXPORT_PREVIEW_ROWS,
  });
  return { rows: page.tasks.map(toTaskCsvRow), matched: page.total };
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
  const [createData, projectOptions] = await Promise.all([
    loadCreateTaskData(session?.user.id ?? null),
    getProjectFilterOptions(),
  ]);
  return { ...createData, projectOptions };
}

/**
 * Everything the New Task wizard opened from the sidebar needs, in one round
 * trip: assignees and projects of the active workspace plus the create data
 * the modal would otherwise load itself.
 */
export async function loadNewTaskWizardOptions(projectId?: string | null) {
  const session = await getSession();
  const [coworkerOptions, projectOptions, createData] = await Promise.all([
    listTaskAssigneeOptions(session?.session.activeOrganizationId ?? null),
    getProjectFilterOptions(projectId),
    loadCreateTaskData(session?.user.id ?? null),
  ]);

  return { coworkerOptions, projectOptions, ...createData };
}

interface LoadMoreTaskSchedulesParams {
  cursor: string;
  projectId: string | null;
  state: TaskScheduleState | null;
}

export async function loadMoreTaskSchedules({
  cursor,
  projectId,
  state,
}: LoadMoreTaskSchedulesParams): Promise<TaskSchedulesPage> {
  return await taskScheduleService.listSchedules({
    cursor,
    projectId: sanitizeProjectIdFilterInput(projectId),
    state: parseTaskScheduleStateFilter(state),
    limit: TASK_SCHEDULES_PAGE_LIMIT,
  });
}

/**
 * Assignees and projects for the Task Schedule dialog opened from a Task's
 * "Repeat", loaded only when someone opens it.
 */
export async function loadTaskScheduleDialogOptions() {
  const [coworkerOptions, projectOptions] = await Promise.all([
    listTaskScheduleAssigneeOptions(),
    getProjectFilterOptions(),
  ]);
  return { coworkerOptions, projectOptions };
}
