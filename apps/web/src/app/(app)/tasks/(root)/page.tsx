import { TaskStatus } from "@sokosumi/core-client";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type { CalendarPageSearchParams } from "@/app/calendar/load-calendar-page";
import CalendarLoading from "@/app/calendar/loading";
import { TasksCalendarPanel } from "@/app/tasks/components/tasks-calendar-panel";
import { TasksPageSkeletonHost } from "@/app/tasks/components/tasks-page-skeleton-host";
import { TasksPendingVendorGrantBannerSlot } from "@/app/tasks/components/tasks-pending-vendor-grant-banner-slot";
import { TasksView } from "@/app/tasks/components/tasks-view";
import {
  KANBAN_COLUMNS,
  type KanbanColumnId,
} from "@/app/tasks/types/task-board";
import { findCoworkerIdBySlug } from "@/app/tasks/utils/coworker-options";
import { listTaskAssigneeMemberOptions } from "@/app/tasks/utils/task-assignee-members";
import { listTaskAssigneeOptions } from "@/app/tasks/utils/task-assignee-options";
import { getTasksColumnPage } from "@/app/tasks/utils/tasks-column-page";
import {
  type ProjectFilterOption,
  parseTasksFilters,
} from "@/app/tasks/utils/tasks-filters";
import { getTasksListPage } from "@/app/tasks/utils/tasks-list-page";
import { TASKS_COLUMN_PAGE_LIMIT } from "@/app/tasks/utils/tasks-pagination";
import { parseTasksTab } from "@/app/tasks/utils/tasks-tab";
import { getSession } from "@/lib/auth/auth.server";
import { coworkerService } from "@/lib/services/coworker.service";
import { organizationSeatService } from "@/lib/services/organization-seat.service";
import { projectService } from "@/lib/services/project.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { taskService } from "@/lib/services/task.service";
import {
  parseTasksDensity,
  TASKS_DENSITY_COOKIE_NAME,
} from "@/lib/ui-preferences/tasks-density";
import { getDefaultTasksViewMode } from "@/lib/ui-preferences/tasks-view-mode.server";

interface TasksPageProps {
  searchParams: Promise<{
    create?: string;
    assignee?: string;
    /** @deprecated Use `assignee`. Kept for bookmarked URLs. */
    coworker?: string;
    prompt?: string;
    scope?: string | string[];
    assigneeId?: string | string[];
    assigneeSokoBotId?: string | string[];
    /** @deprecated Use `assigneeId`. Kept for bookmarked URLs. */
    coworkerId?: string | string[];
    status?: string | string[];
    projectId?: string | string[];
    visibility?: string | string[];
    tab?: string | string[];
    date?: string;
    view?: string;
    timezone?: string;
    sourceId?: string;
    socialOnly?: string;
    assigneeUserId?: string | string[];
  }>;
}

function calendarSearchParamsFromTasksPage(
  params: Awaited<TasksPageProps["searchParams"]>,
): CalendarPageSearchParams {
  const first = (value: string | string[] | undefined) =>
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value[0]
        : undefined;

  return {
    assigneeId: first(params.assigneeId),
    assigneeUserId: first(params.assigneeUserId),
    date: params.date,
    projectId: first(params.projectId),
    sourceId: params.sourceId,
    scope: first(params.scope),
    socialOnly: params.socialOnly,
    status: first(params.status),
    view: params.view,
    timezone: params.timezone,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Tasks.Page");

  return {
    title: t("title"),
    description: t("description"),
  };
}

const PROJECT_FILTER_OPTIONS_LIMIT = 100;

function emptyColumnNextCursorById(): Record<KanbanColumnId, string | null> {
  return Object.fromEntries(
    KANBAN_COLUMNS.map((column) => [column.id, null]),
  ) as Record<KanbanColumnId, string | null>;
}

async function loadTasksPageData() {
  return await Promise.all([
    coworkerService.listCoworkers("tasks").catch(() => []),
    projectService.listProjects({ limit: PROJECT_FILTER_OPTIONS_LIMIT }),
    sokoBotService.getMine().catch(() => null),
  ]);
}

async function TasksPageContent({ searchParams }: TasksPageProps) {
  // Defer before any cookies()/headers()-bound work so PPR shell probing does
  // not soft-reject dynamic APIs while filling this Suspense hole.
  await connection();

  const resolvedSearchParams = await searchParams;
  const {
    create,
    assignee: assigneeSlugParam,
    coworker: legacyCoworkerSlugParam,
    prompt: promptParam,
    scope,
    assigneeId,
    assigneeSokoBotId,
    coworkerId: legacyCoworkerId,
    status,
    projectId,
    visibility,
    tab,
  } = resolvedSearchParams;
  const initialTab = parseTasksTab(tab);
  const [
    t,
    tColumns,
    tDetailActions,
    tApp,
    cookieStore,
    session,
    defaultViewMode,
  ] = await Promise.all([
    getTranslations("App.Tasks"),
    getTranslations("App.Tasks.Columns"),
    getTranslations("App.Tasks.Detail.actions"),
    getTranslations("App"),
    cookies(),
    getSession(),
    getDefaultTasksViewMode(),
  ]);
  const defaultDensity =
    parseTasksDensity(cookieStore.get(TASKS_DENSITY_COOKIE_NAME)?.value) ??
    "normal";
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const [taskCoworkers, projectsPage, ownerBot] = await loadTasksPageData();
  const memberOptions =
    await listTaskAssigneeMemberOptions(activeOrganizationId);
  // Core decides schedule eligibility; start that request before loading the board.
  const coworkerOptionsPromise = listTaskAssigneeOptions(
    activeOrganizationId,
    memberOptions,
  );
  const filters = parseTasksFilters(
    {
      scope,
      assigneeId,
      assigneeSokoBotId,
      coworkerId: legacyCoworkerId,
      status,
      projectId,
      visibility,
    },
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
    coworkersById,
    personalAssistantFallback: t("personalAssistant"),
  };

  const [tasksPageResult, parkedTasksPage] = await Promise.all([
    defaultViewMode === "list"
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
          scope: activeFilters.scope,
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

  const coworkerOptions = await coworkerOptionsPromise;
  const canCreateTask =
    await organizationSeatService.hasAssignedSeat(activeOrganizationId);
  const initialCreateTaskOpen = create === "true";
  const resolvedAssigneeSlug = assigneeSlugParam ?? legacyCoworkerSlugParam;
  const initialAssigneeId =
    initialCreateTaskOpen && resolvedAssigneeSlug
      ? findCoworkerIdBySlug(coworkerOptions, resolvedAssigneeSlug)
      : null;
  const initialProjectId = activeFilters.projectId;
  const calendarSearchParams =
    calendarSearchParamsFromTasksPage(resolvedSearchParams);

  const parkedTaskCount = parkedTasksPage.pagination?.total ?? 0;

  const columnLabels: Record<KanbanColumnId, string> = {
    backlog: tColumns("backlog"),
    todo: tColumns("todo"),
    "in-progress": tColumns("inProgress"),
    "input-required": tColumns("inputRequired"),
    done: tColumns("done"),
  };

  return (
    <div className="content-in w-full">
      <Suspense fallback={null}>
        <TasksPendingVendorGrantBannerSlot
          activeOrganizationId={activeOrganizationId}
          parkedTaskCount={parkedTaskCount}
        />
      </Suspense>
      <TasksView
        tasks={tasks}
        initialTab={initialTab}
        listNextCursor={listNextCursor}
        columnNextCursorById={columnNextCursorById}
        columns={KANBAN_COLUMNS}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        userId={session?.user.id ?? null}
        activeOrganizationId={activeOrganizationId}
        initialFilters={activeFilters}
        calendar={
          initialTab === "calendar" ? (
            <Suspense fallback={<CalendarLoading />}>
              <TasksCalendarPanel
                searchParams={Promise.resolve(calendarSearchParams)}
              />
            </Suspense>
          ) : (
            // Client tab switch hits router.replace; show shell until RSC
            // brings TasksCalendarPanel. Avoids loading calendar on board.
            <CalendarLoading />
          )
        }
        defaultViewMode={defaultViewMode}
        defaultDensity={defaultDensity}
        initialCreateTaskOpen={initialCreateTaskOpen && canCreateTask}
        canCreateTask={canCreateTask}
        initialAssigneeId={initialAssigneeId}
        initialCreateTaskPrompt={
          initialCreateTaskOpen ? (promptParam ?? null) : null
        }
        createTaskModalResetKey={`${String(initialCreateTaskOpen)}-${initialAssigneeId ?? resolvedAssigneeSlug ?? ""}-${initialProjectId ?? ""}-${(promptParam ?? "").slice(0, 32)}`}
        labels={{
          tabs: {
            tasks: t("Tabs.tasks"),
            calendar: t("Tabs.calendar"),
          },
          filters: {
            title: t("Filters.title"),
            searchPlaceholder: t("Filters.searchPlaceholder"),
            emptyResults: t("Filters.emptyResults"),
            all: t("Filters.all"),
            scopeLabel: t("Filters.scopeLabel"),
            scopeOwned: t("Filters.scopeOwned"),
            scopeWorkspace: t("Filters.scopeWorkspace"),
            coworkerLabel: t("Filters.coworkerLabel"),
            statusLabel: t("Filters.statusLabel"),
            visibilityLabel: t("Filters.visibilityLabel"),
            visibilityPrivate: t("Filters.visibilityPrivate"),
            statusOptions: {
              [TaskStatus.DRAFT]: t("Filters.statusOptions.DRAFT"),
              [TaskStatus.QUEUED]: t("Filters.statusOptions.QUEUED"),
              [TaskStatus.READY]: t("Filters.statusOptions.READY"),
              [TaskStatus.GRANT_PENDING]: t(
                "Filters.statusOptions.GRANT_PENDING",
              ),
              [TaskStatus.INPUT_REQUIRED]: t(
                "Filters.statusOptions.INPUT_REQUIRED",
              ),
              [TaskStatus.APPROVAL_REQUIRED]: t(
                "Filters.statusOptions.APPROVAL_REQUIRED",
              ),
              [TaskStatus.AUTHENTICATION_REQUIRED]: t(
                "Filters.statusOptions.AUTHENTICATION_REQUIRED",
              ),
              [TaskStatus.OUT_OF_CREDITS]: t(
                "Filters.statusOptions.OUT_OF_CREDITS",
              ),
              [TaskStatus.CREDITS_TOPPED_UP]: t(
                "Filters.statusOptions.CREDITS_TOPPED_UP",
              ),
              [TaskStatus.RUNNING]: t("Filters.statusOptions.RUNNING"),
              [TaskStatus.AWAITING_EXTERNAL]: t(
                "Filters.statusOptions.AWAITING_EXTERNAL",
              ),
              [TaskStatus.COMPLETED]: t("Filters.statusOptions.COMPLETED"),
              [TaskStatus.FAILED]: t("Filters.statusOptions.FAILED"),
              [TaskStatus.CANCELED]: t("Filters.statusOptions.CANCELED"),
            },
          },
          columns: columnLabels,
          dragError: t("Errors.updateStatus"),
          loadMoreError: t("Errors.loadMore"),
          reopenToReady: {
            title: tDetailActions("reopenToReadyTitle"),
            description: tDetailActions("reopenToReadyDescription"),
            commentLabel: tDetailActions("reopenToReadyCommentLabel"),
            commentPlaceholder: tDetailActions(
              "reopenToReadyCommentPlaceholder",
            ),
            commentRequired: tDetailActions("reopenToReadyCommentRequired"),
            confirm: tDetailActions("reopenToReadyConfirm"),
            cancel: tApp("cancel"),
          },
          display: {
            button: t("Display.button"),
            list: t("Display.list"),
            board: t("Display.board"),
            density: t("Display.density"),
            normal: t("Display.normal"),
            compact: t("Display.compact"),
          },
          listPlaceholder: t("List.placeholder"),
          loadMore: t("Actions.loadMore"),
        }}
      />
    </div>
  );
}

export default function TasksPage({ searchParams }: TasksPageProps) {
  return (
    <Suspense fallback={<TasksPageSkeletonHost />}>
      <TasksPageContent searchParams={searchParams} />
    </Suspense>
  );
}
