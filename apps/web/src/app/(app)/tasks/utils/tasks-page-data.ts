import "server-only";

import { TaskStatus } from "@sokosumi/core-client";
import type { Session } from "@sokosumi/utils";
import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import {
  KANBAN_COLUMNS,
  type KanbanColumnId,
} from "@/app/tasks/types/task-board";
import { findCoworkerIdBySlug } from "@/app/tasks/utils/coworker-options";
import { listTaskAssigneeMemberOptions } from "@/app/tasks/utils/task-assignee-members";
import { listTaskAssigneeOptions } from "@/app/tasks/utils/task-assignee-options";
import { getTasksColumnPage } from "@/app/tasks/utils/tasks-column-page";
import {
  buildTasksFiltersSearchParams,
  getTaskTagQuery,
  type ProjectFilterOption,
  parseTasksFilters,
  pickTasksViewQuery,
  type TasksFiltersSearchParams,
  tasksQueryScope,
} from "@/app/tasks/utils/tasks-filters";
import { getTasksListPage } from "@/app/tasks/utils/tasks-list-page";
import { TASKS_COLUMN_PAGE_LIMIT } from "@/app/tasks/utils/tasks-pagination";
import { getSession, getSessionResult } from "@/lib/auth/auth.server";
import { CoreAuthUnavailableError } from "@/lib/auth/errors";
import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";
import { coworkerService } from "@/lib/services/coworker.service";
import { organizationSeatService } from "@/lib/services/organization-seat.service";
import { projectService } from "@/lib/services/project.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { taskService } from "@/lib/services/task.service";
import type { TasksViewMode } from "@/lib/ui-preferences/tasks-view-mode";
import { effectiveTasksSort } from "./task-sort";

export interface TasksPageDataInput {
  filterParams: TasksFiltersSearchParams;
  viewMode: TasksViewMode;
  personalAssistantFallback: string;
  /** Resolves `?assignee=` to an id only when the create dialog opens. */
  createAssigneeSlug: string | null;
  /** The URL names no view, so the reader's saved view opens. */
  restoreSavedView: boolean;
}

/** The saved view, or null when none is saved or Core cannot say. */
function readSavedTasksView(): Promise<string | null> {
  return taskService.getSavedTasksViewQuery().catch((error: unknown) => {
    unstable_rethrow(error);
    // The defaults beat no page.
    console.error("Failed to load the saved Tasks view", error);
    return null;
  });
}

const PROJECT_FILTER_OPTIONS_LIMIT = 100;

function emptyColumnHiddenCountById(): Record<KanbanColumnId, number> {
  return Object.fromEntries(
    KANBAN_COLUMNS.map((column) => [column.id, 0]),
  ) as Record<KanbanColumnId, number>;
}

function emptyColumnNextCursorById(): Record<KanbanColumnId, string | null> {
  return Object.fromEntries(
    KANBAN_COLUMNS.map((column) => [column.id, null]),
  ) as Record<KanbanColumnId, string | null>;
}

async function loadTasksPageOptions() {
  return await Promise.all([
    coworkerService.listCoworkers("tasks").catch(() => []),
    projectService.listProjects({ limit: PROJECT_FILTER_OPTIONS_LIMIT }),
    sokoBotService.getMine().catch(() => null),
  ]);
}

async function readTasksPageData(
  {
    filterParams,
    viewMode,
    personalAssistantFallback,
    createAssigneeSlug,
    restoreSavedView,
  }: TasksPageDataInput,
  session: Session | null,
) {
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const [[taskCoworkers, projectsPage, ownerBot], memberOptions, savedView] =
    await Promise.all([
      loadTasksPageOptions(),
      listTaskAssigneeMemberOptions(activeOrganizationId),
      restoreSavedView ? readSavedTasksView() : null,
    ]);
  // Runs beside the board reads, not after them.
  const canCreateTaskPromise =
    organizationSeatService.hasAssignedSeat(activeOrganizationId);
  // Core decides schedule eligibility; start that request before loading the board.
  const coworkerOptionsPromise = listTaskAssigneeOptions(
    activeOrganizationId,
    memberOptions,
  );
  // The saved view fills the view keys the URL left out; the project stays
  // the URL's. The checks below drop assignees and coworkers that went stale
  // since it was saved. A deleted tag stays and shows as a removable chip.
  const filters = parseTasksFilters(
    savedView
      ? {
          ...filterParams,
          ...Object.fromEntries(
            new URLSearchParams(
              pickTasksViewQuery(new URLSearchParams(savedView)),
            ),
          ),
        }
      : filterParams,
    activeOrganizationId,
  );
  let projectOptions: ProjectFilterOption[] = projectsPage.projects.map(
    (project) => ({
      id: project.id,
      name: project.name,
      logo: project.logo,
      designMd: project.designMd,
      briefingUrl: project.briefingUrl,
      contextMd: project.contextMd,
    }),
  );
  if (
    filters.projectId &&
    !projectOptions.some((project) => project.id === filters.projectId)
  ) {
    const selectedProject = await projectService.getProjectById(
      filters.projectId,
    );
    if (selectedProject) {
      projectOptions = [
        {
          id: selectedProject.id,
          name: selectedProject.name,
          logo: selectedProject.logo,
          designMd: selectedProject.designMd,
          briefingUrl: selectedProject.briefingUrl,
          contextMd: selectedProject.contextMd,
        },
        ...projectOptions,
      ];
    }
  }
  const coworkersById = new Map(
    taskCoworkers.map((coworker) => [coworker.id, coworker]),
  );
  const validCoworkerIds = new Set(
    taskCoworkers.map((coworker) => coworker.id),
  );
  const ownerSokoBotId = ownerBot?.id ?? null;
  const validProjectIds = new Set(projectOptions.map((project) => project.id));
  const activeFilters = {
    ...filters,
    assigneeId:
      filters.assigneeId &&
      validCoworkerIds.has(filters.assigneeId) &&
      filters.assigneeId !== ownerSokoBotId
        ? filters.assigneeId
        : null,
    assigneeSokoBotId:
      filters.assigneeSokoBotId &&
      ownerSokoBotId &&
      filters.assigneeSokoBotId === ownerSokoBotId
        ? filters.assigneeSokoBotId
        : null,
    assigneeUserId:
      filters.assigneeUserId &&
      memberOptions.some((member) => member.id === filters.assigneeUserId)
        ? filters.assigneeUserId
        : null,
    projectId:
      filters.projectId && validProjectIds.has(filters.projectId)
        ? filters.projectId
        : null,
  };
  const shouldCountGrantPendingTasks =
    activeFilters.status == null ||
    activeFilters.status === TaskStatus.GRANT_PENDING;

  const listPageParams = {
    cursor: null as string | null,
    limit: TASKS_COLUMN_PAGE_LIMIT,
    scope: activeFilters.scope,
    assigneeId: activeFilters.assigneeId,
    assigneeSokoBotId: activeFilters.assigneeSokoBotId,
    assigneeUserId: activeFilters.assigneeUserId,
    status: activeFilters.status,
    projectId: activeFilters.projectId,
    visibility: activeFilters.visibility,
    tag: activeFilters.tag,
    stuck: activeFilters.stuck,
    needsMe: activeFilters.needsMe,
    mentions: activeFilters.mentions,
    // The order the menu shows, so the first page holds what the board claims.
    sort: effectiveTasksSort(activeFilters.sort, viewMode),
    coworkersById,
    personalAssistantFallback,
  };

  const [tasksPageResult, parkedTasksPage] = await Promise.all([
    viewMode === "list"
      ? getTasksListPage(listPageParams).then((page) => ({
          mode: "list" as const,
          page,
        }))
      : Promise.all(
          KANBAN_COLUMNS.map(async (column) => {
            const page = await getTasksColumnPage({
              columnId: column.id,
              ...listPageParams,
            });

            return [column.id, page] as const;
          }),
        ).then((columnPages) => ({
          mode: "board" as const,
          columnPages,
        })),
    shouldCountGrantPendingTasks
      ? taskService.listTasks({
          status: TaskStatus.GRANT_PENDING,
          ...getTaskTagQuery(activeFilters.tag),
          scope: tasksQueryScope(activeFilters.scope, activeFilters),
          ...(activeFilters.mentions ? { unansweredMention: true } : {}),
          assigneeId: activeFilters.assigneeId ?? undefined,
          assigneeSokoBotId: activeFilters.assigneeSokoBotId ?? undefined,
          assigneeUserId: activeFilters.assigneeUserId ?? undefined,
          projectId: activeFilters.projectId ?? undefined,
          ...(activeFilters.visibility
            ? { visibility: activeFilters.visibility }
            : {}),
          limit: 1,
        })
      : Promise.resolve({ tasks: [], pagination: null }),
  ]);

  const tasks =
    tasksPageResult.mode === "list"
      ? tasksPageResult.page.tasks
      : tasksPageResult.columnPages.flatMap(([_columnId, page]) => page.tasks);
  const listNextCursor =
    tasksPageResult.mode === "list" ? tasksPageResult.page.nextCursor : null;
  const columnNextCursorById =
    tasksPageResult.mode === "list"
      ? emptyColumnNextCursorById()
      : (Object.fromEntries(
          tasksPageResult.columnPages.map(([columnId, page]) => [
            columnId,
            page.nextCursor,
          ]),
        ) as Record<KanbanColumnId, string | null>);

  // Tasks past the first page of each column: its header counts them too.
  const columnHiddenCountById =
    tasksPageResult.mode === "list"
      ? emptyColumnHiddenCountById()
      : (Object.fromEntries(
          tasksPageResult.columnPages.map(([columnId, page]) => [
            columnId,
            page.nextCursor ? Math.max(0, page.total - page.tasks.length) : 0,
          ]),
        ) as Record<KanbanColumnId, number>);

  const coworkerOptions = await coworkerOptionsPromise;
  const canCreateTask = await canCreateTaskPromise;

  return {
    tasks,
    listNextCursor,
    columnNextCursorById,
    columnHiddenCountById,
    coworkerOptions,
    projectOptions,
    userId: session?.user.id ?? null,
    activeOrganizationId,
    activeFilters,
    canCreateTask,
    initialAssigneeId: createAssigneeSlug
      ? findCoworkerIdBySlug(coworkerOptions, createAssigneeSlug)
      : null,
    parkedTaskCount: parkedTasksPage.pagination?.total ?? 0,
    // Rebuilt from the checked filters, so a stale value never reaches the URL.
    restoredQuery: restoreSavedView
      ? savedView
        ? pickTasksViewQuery(
            buildTasksFiltersSearchParams(new URLSearchParams(), activeFilters),
          )
        : ""
      : null,
  };
}

type TasksPageData = Awaited<ReturnType<typeof readTasksPageData>>;

async function readPrivateCachedTasksPageData(
  input: TasksPageDataInput,
): Promise<TasksPageData> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  const sessionResult = await getSessionResult();
  // Thrown, never cached: an outage must not be kept as "signed out".
  if (sessionResult.isErr()) {
    throw new CoreAuthUnavailableError(sessionResult.error.reason);
  }
  return readTasksPageData(input, sessionResult.value);
}

/**
 * The tasks page's Core reads, cached for the browser only, so a link
 * prefetch carries the page. A failed read is never kept: the page then
 * renders fresh on the click, with the same reads uncached.
 */
export function loadTasksPageData(
  input: TasksPageDataInput,
): Promise<TasksPageData> {
  return readPrivateCachedTasksPageData(input).catch(async (error: unknown) => {
    unstable_rethrow(error);
    await connection();
    return readTasksPageData(input, await getSession());
  });
}
