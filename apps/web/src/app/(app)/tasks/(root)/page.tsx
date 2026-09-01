import { cookies } from "next/headers";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { TasksPageSkeletonHost } from "@/app/tasks/components/tasks-page-skeleton-host";
import { TasksPendingVendorGrantBannerSlot } from "@/app/tasks/components/tasks-pending-vendor-grant-banner-slot";
import { TasksView } from "@/app/tasks/components/tasks-view";
import {
  KANBAN_COLUMNS,
  type KanbanColumnId,
} from "@/app/tasks/types/task-board";
import {
  findCoworkerIdBySlug,
  getCoworkerOptions,
} from "@/app/tasks/utils/coworker-options";
import { buildPaAssigneeOption } from "@/app/tasks/utils/pa-assignee-option";
import {
  parseJobsListFilters,
  sanitizeJobAgentIdForPersistedFilter,
} from "@/app/tasks/utils/jobs-filters";
import { getTasksColumnPage } from "@/app/tasks/utils/tasks-column-page";
import {
  firstQueryString,
  normalizeOptionalString,
  type ProjectFilterOption,
  parseTasksFilters,
} from "@/app/tasks/utils/tasks-filters";
import { getTasksListPage } from "@/app/tasks/utils/tasks-list-page";
import { TASKS_COLUMN_PAGE_LIMIT } from "@/app/tasks/utils/tasks-pagination";
import { getSession } from "@/lib/auth/auth.server";
import { AgentJobStatus, TaskStatus } from "@/lib/clients/generated/core";
import { coworkerService } from "@/lib/services/coworker.service";
import { hasAssignedOrganizationSeat } from "@/lib/services/organization-assigned-seat.service";
import { projectService } from "@/lib/services/project.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { taskService } from "@/lib/services/task.service";
import type { CoworkerOption } from "@/lib/types/coworker";
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
    /** @deprecated Use `assigneeId`. Kept for bookmarked URLs. */
    coworkerId?: string | string[];
    status?: string | string[];
    projectId?: string | string[];
    agentId?: string | string[];
    jobStatus?: string | string[];
  }>;
}

export const metadata = {
  title: "Task Manager",
};

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

  const {
    create,
    assignee: assigneeSlugParam,
    coworker: legacyCoworkerSlugParam,
    prompt: promptParam,
    scope,
    assigneeId,
    coworkerId: legacyCoworkerId,
    status,
    projectId,
    agentId,
    jobStatus,
  } = await searchParams;
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
  const [taskCoworkers, projectsPage, sokoBot] = await loadTasksPageData();
  const filters = parseTasksFilters(
    { scope, assigneeId, coworkerId: legacyCoworkerId, status, projectId },
    activeOrganizationId,
  );
  const jobsListFilters = {
    ...parseJobsListFilters(
      { scope, agentId, jobStatus, projectId },
      activeOrganizationId,
      [],
    ),
    agentId: sanitizeJobAgentIdForPersistedFilter(
      normalizeOptionalString(firstQueryString(agentId)),
    ),
  };
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
  const validProjectIds = new Set(projectOptions.map((project) => project.id));
  const activeFilters = {
    ...filters,
    assigneeId:
      filters.assigneeId && validCoworkerIds.has(filters.assigneeId)
        ? filters.assigneeId
        : null,
    projectId:
      filters.projectId && validProjectIds.has(filters.projectId)
        ? filters.projectId
        : null,
  };
  const activeJobsListFilters = {
    ...jobsListFilters,
    projectId:
      jobsListFilters.projectId &&
      validProjectIds.has(jobsListFilters.projectId)
        ? jobsListFilters.projectId
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
    status: activeFilters.status,
    projectId: activeFilters.projectId,
    coworkersById,
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
          projectId: activeFilters.projectId ?? undefined,
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

  const coworkerOptions: CoworkerOption[] = getCoworkerOptions(taskCoworkers);
  const paAssigneeOption = buildPaAssigneeOption(sokoBot);
  const canCreateTask = await hasAssignedOrganizationSeat(activeOrganizationId);
  const initialCreateTaskOpen = create === "true";
  const resolvedAssigneeSlug = assigneeSlugParam ?? legacyCoworkerSlugParam;
  const initialAssigneeId =
    initialCreateTaskOpen && resolvedAssigneeSlug
      ? findCoworkerIdBySlug(coworkerOptions, resolvedAssigneeSlug)
      : null;
  const initialProjectId =
    activeFilters.projectId ?? activeJobsListFilters.projectId;

  const parkedTaskCount = parkedTasksPage.pagination?.total ?? 0;

  const columnLabels: Record<KanbanColumnId, string> = {
    backlog: tColumns("backlog"),
    todo: tColumns("todo"),
    "in-progress": tColumns("inProgress"),
    "input-required": tColumns("inputRequired"),
    done: tColumns("done"),
  };

  return (
    <div className="w-full px-2">
      <Suspense fallback={null}>
        <TasksPendingVendorGrantBannerSlot
          activeOrganizationId={activeOrganizationId}
          parkedTaskCount={parkedTaskCount}
        />
      </Suspense>
      <TasksView
        tasks={tasks}
        listNextCursor={listNextCursor}
        columnNextCursorById={columnNextCursorById}
        columns={KANBAN_COLUMNS}
        coworkerOptions={coworkerOptions}
        paAssigneeOption={paAssigneeOption}
        projectOptions={projectOptions}
        userId={session?.user.id ?? null}
        activeOrganizationId={activeOrganizationId}
        initialFilters={activeFilters}
        initialJobsListFilters={activeJobsListFilters}
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
            jobs: t("Tabs.jobs"),
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
          add: t("Actions.add"),
          addTask: t("Actions.addTask"),
          dragError: t("Errors.updateStatus"),
          loadMoreError: t("Errors.loadMore"),
          loadJobsError: t("Errors.loadJobs"),
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
          jobs: {
            filterButton: t("Jobs.filterButton"),
            agentLabel: t("Jobs.agentLabel"),
            jobStatusLabel: t("Jobs.jobStatusLabel"),
            jobStatusOptions: {
              [AgentJobStatus.INITIATED]: t("Jobs.jobStatusOptions.INITIATED"),
              [AgentJobStatus.AWAITING_PAYMENT]: t(
                "Jobs.jobStatusOptions.AWAITING_PAYMENT",
              ),
              [AgentJobStatus.AWAITING_INPUT]: t(
                "Jobs.jobStatusOptions.AWAITING_INPUT",
              ),
              [AgentJobStatus.RUNNING]: t("Jobs.jobStatusOptions.RUNNING"),
              [AgentJobStatus.COMPLETED]: t("Jobs.jobStatusOptions.COMPLETED"),
              [AgentJobStatus.FAILED]: t("Jobs.jobStatusOptions.FAILED"),
            },
            recentTitle: t("Jobs.recentTitle"),
            emptyRecent: t("Jobs.emptyRecent"),
            emptyList: t("Jobs.emptyList"),
            emptySection: t("Jobs.emptySection"),
            untitled: t("Jobs.untitled"),
            unknownAgent: t("Jobs.unknownAgent"),
          },
          emptyState: {
            title: t("EmptyState.title"),
            description: t("EmptyState.description"),
            getStartedTitle: t("EmptyState.getStartedTitle"),
            getStartedDescription: t("EmptyState.getStartedDescription"),
            getStartedButton: t("EmptyState.getStartedButton"),
            next: t("EmptyState.next"),
            back: t("EmptyState.back"),
            addTaskHint: t("EmptyState.addTaskHint"),
            elenaAvatarAlt: t("EmptyState.elenaAvatarAlt"),
          },
          showGuideAriaLabel: t("Actions.showGuide"),
          loadMore: t("Actions.loadMore"),
          loading: t("Actions.loading"),
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
