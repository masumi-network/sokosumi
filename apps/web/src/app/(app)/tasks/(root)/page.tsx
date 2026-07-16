import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { TasksPendingVendorGrantBannerSlot } from "@/app/tasks/components/tasks-pending-vendor-grant-banner-slot";
import { TasksView } from "@/app/tasks/components/tasks-view";
import { buildAgentNameById } from "@/app/tasks/utils/agent-names";
import {
  findCoworkerIdBySlug,
  getCoworkerOptions,
} from "@/app/tasks/utils/coworker-options";
import { parseJobsListFilters } from "@/app/tasks/utils/jobs-filters";
import { mapJobsToTasksViewData } from "@/app/tasks/utils/jobs-view-data";
import { getTasksColumnPage } from "@/app/tasks/utils/tasks-column-page";
import {
  type ProjectFilterOption,
  parseTasksFilters,
} from "@/app/tasks/utils/tasks-filters";
import { TASKS_COLUMN_PAGE_LIMIT } from "@/app/tasks/utils/tasks-pagination";
import { getSession } from "@/lib/auth/auth.server";
import { AgentJobStatus, TaskStatus } from "@/lib/clients/generated/core";
import { getAgentResolvedIcon } from "@/lib/helpers/agent";
import { agentService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { designMdService } from "@/lib/services/design-md.service";
import { projectService } from "@/lib/services/project.service";
import { taskService } from "@/lib/services/task.service";
import type { CoworkerOption } from "@/lib/types/coworker";
import { KANBAN_COLUMNS, type KanbanColumnId } from "@/lib/types/task";
import {
  parseTasksDensity,
  TASKS_DENSITY_COOKIE_NAME,
} from "@/lib/ui-preferences/tasks-density";
import {
  parseTasksViewMode,
  TASKS_VIEW_MODE_COOKIE_NAME,
} from "@/lib/ui-preferences/tasks-view-mode";

interface TasksPageProps {
  searchParams: Promise<{
    create?: string;
    coworker?: string;
    prompt?: string;
    scope?: string | string[];
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

async function loadTasksPageData() {
  return await Promise.all([
    coworkerService.listCoworkers("tasks").catch(() => []),
    agentService.getAvailableAgentsWithCreditsPrice(),
    projectService.listProjects({ limit: PROJECT_FILTER_OPTIONS_LIMIT }),
  ]);
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const {
    create,
    coworker: coworkerSlugParam,
    prompt: promptParam,
    scope,
    coworkerId,
    status,
    projectId,
    agentId,
    jobStatus,
  } = await searchParams;
  const [t, tColumns, cookieStore, session] = await Promise.all([
    getTranslations("App.Tasks"),
    getTranslations("App.Tasks.Columns"),
    cookies(),
    getSession(),
  ]);
  const defaultViewMode =
    parseTasksViewMode(cookieStore.get(TASKS_VIEW_MODE_COOKIE_NAME)?.value) ??
    "board";
  const defaultDensity =
    parseTasksDensity(cookieStore.get(TASKS_DENSITY_COOKIE_NAME)?.value) ??
    "normal";
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const [taskCoworkers, agents, projectsPage] = await loadTasksPageData();
  const filters = parseTasksFilters(
    { scope, coworkerId, status, projectId },
    activeOrganizationId,
  );
  const agentNameById = buildAgentNameById(agents);
  const jobAgentOptions = agents.map((agent) => ({
    id: agent.id,
    name: agentNameById.get(agent.id) ?? agent.name,
    image: getAgentResolvedIcon(agent),
  }));
  const jobsListFilters = parseJobsListFilters(
    { scope, agentId, jobStatus, projectId },
    activeOrganizationId,
    jobAgentOptions,
  );
  let projectOptions: ProjectFilterOption[] = projectsPage.projects.map(
    (project) => ({
      id: project.id,
      name: project.name,
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
        { id: selectedProject.id, name: selectedProject.name },
        ...projectOptions,
      ];
    }
  }
  const coworkersById = new Map(
    taskCoworkers.map((coworker) => [coworker.id, coworker]),
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const validCoworkerIds = new Set(
    taskCoworkers.map((coworker) => coworker.id),
  );
  const validProjectIds = new Set(projectOptions.map((project) => project.id));
  const activeFilters = {
    ...filters,
    coworkerId:
      filters.coworkerId && validCoworkerIds.has(filters.coworkerId)
        ? filters.coworkerId
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

  const [jobsPage, columnPages, initialDesignMdAttachment, parkedTasksPage] =
    await Promise.all([
      taskService.listJobs({
        scope: activeJobsListFilters.scope,
        agentId: activeJobsListFilters.agentId ?? undefined,
        projectId: activeJobsListFilters.projectId ?? undefined,
        status: activeJobsListFilters.jobStatus ?? undefined,
        limit: 20,
      }),
      Promise.all(
        KANBAN_COLUMNS.map(async (column) => {
          const page = await getTasksColumnPage({
            columnId: column.id,
            cursor: null,
            limit: TASKS_COLUMN_PAGE_LIMIT,
            scope: activeFilters.scope,
            coworkerId: activeFilters.coworkerId,
            status: activeFilters.status,
            projectId: activeFilters.projectId,
            coworkersById,
            agentsById,
          });

          return [column.id, page] as const;
        }),
      ),
      session?.user.id ? designMdService.resolveEffectiveDesignMd() : null,
      shouldCountGrantPendingTasks
        ? taskService.listTasks({
            status: TaskStatus.GRANT_PENDING,
            scope: activeFilters.scope,
            coworkerId: activeFilters.coworkerId ?? undefined,
            projectId: activeFilters.projectId ?? undefined,
            limit: 1,
          })
        : Promise.resolve({ tasks: [], pagination: null }),
    ]);
  const tasks = columnPages.flatMap(([_columnId, page]) => page.tasks);
  const columnNextCursorById = Object.fromEntries(
    columnPages.map(([columnId, page]) => [columnId, page.nextCursor]),
  ) as Record<KanbanColumnId, string | null>;
  const seedTasksById = new Map(
    tasks.map((task) => [
      task.id,
      {
        id: task.id,
        coworkerId: task.coworker?.id ?? null,
      },
    ]),
  );

  const { jobs, agentPreviewById } = await mapJobsToTasksViewData({
    jobs: jobsPage.jobs,
    coworkersById,
    knownAgentsById: agentsById,
    seedTasksById,
  });

  const coworkerOptions: CoworkerOption[] = getCoworkerOptions(taskCoworkers);
  const initialCreateTaskOpen = create === "true";
  const initialCoworkerId =
    initialCreateTaskOpen && coworkerSlugParam
      ? findCoworkerIdBySlug(coworkerOptions, coworkerSlugParam)
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
        jobs={jobs}
        jobsNextCursor={jobsPage.pagination?.nextCursor ?? null}
        agentPreviewById={agentPreviewById}
        columnNextCursorById={columnNextCursorById}
        columns={KANBAN_COLUMNS}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        jobAgentOptions={jobAgentOptions}
        agentNameById={agentNameById}
        userId={session?.user.id ?? null}
        activeOrganizationId={activeOrganizationId}
        initialFilters={activeFilters}
        initialJobsListFilters={activeJobsListFilters}
        defaultViewMode={defaultViewMode}
        defaultDensity={defaultDensity}
        initialCreateTaskOpen={initialCreateTaskOpen}
        initialCoworkerId={initialCoworkerId}
        initialCreateTaskPrompt={
          initialCreateTaskOpen ? (promptParam ?? null) : null
        }
        initialDesignMdAttachment={initialDesignMdAttachment}
        createTaskModalResetKey={`${String(initialCreateTaskOpen)}-${initialCoworkerId ?? coworkerSlugParam ?? ""}-${initialProjectId ?? ""}-${(promptParam ?? "").slice(0, 32)}`}
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
            projectLabel: t("Filters.projectLabel"),
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
              [TaskStatus.CANCEL_REQUESTED]: t(
                "Filters.statusOptions.CANCEL_REQUESTED",
              ),
              [TaskStatus.CANCELED]: t("Filters.statusOptions.CANCELED"),
            },
          },
          columns: columnLabels,
          add: t("Actions.add"),
          addTask: t("Actions.addTask"),
          dragError: t("Errors.updateStatus"),
          loadMoreError: t("Errors.loadMore"),
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
            chatTitle: t("EmptyState.chatTitle"),
            chatDescription: t("EmptyState.chatDescription"),
            getStartedTitle: t("EmptyState.getStartedTitle"),
            getStartedDescription: t("EmptyState.getStartedDescription"),
            getStartedButton: t("EmptyState.getStartedButton"),
            next: t("EmptyState.next"),
            back: t("EmptyState.back"),
            addTaskHint: t("EmptyState.addTaskHint"),
            chatHint: t("EmptyState.chatHint"),
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
