import { TaskStatus } from "@sokosumi/database";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { TasksView } from "@/app/tasks/components/tasks-view";
import { buildAgentNameById } from "@/app/tasks/utils/agent-names";
import {
  findCoworkerIdBySlug,
  getCoworkerOptions,
} from "@/app/tasks/utils/coworker-options";
import { mapJobsToTasksViewData } from "@/app/tasks/utils/jobs-view-data";
import { getTasksColumnPage } from "@/app/tasks/utils/tasks-column-page";
import { parseTasksFilters } from "@/app/tasks/utils/tasks-filters";
import { TASKS_COLUMN_PAGE_LIMIT } from "@/app/tasks/utils/tasks-pagination";
import { getSession } from "@/lib/auth/utils";
import { agentService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { userService } from "@/lib/services/user.service";
import type { CoworkerOption } from "@/lib/types/coworker";
import { KANBAN_COLUMNS, type KanbanColumnId } from "@/lib/types/task";
import {
  parseTasksViewMode,
  TASKS_VIEW_MODE_COOKIE_NAME,
} from "@/lib/ui-preferences/tasks-view-mode";

interface TasksPageProps {
  searchParams: Promise<{
    create?: string;
    coworker?: string;
    scope?: string | string[];
    coworkerId?: string | string[];
    status?: string | string[];
  }>;
}

export const metadata = {
  title: "Task Manager",
};

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const {
    create,
    coworker: coworkerSlugParam,
    scope,
    coworkerId,
    status,
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
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const filters = parseTasksFilters(
    { scope, coworkerId, status },
    activeOrganizationId,
  );

  const [taskCoworkers, agents, jobsPage] = await Promise.all([
    coworkerService.listCoworkers("tasks"),
    agentService.getAvailableAgentsWithCreditsPrice(),
    userService.listMyJobsForActiveContextPaginated({ limit: 20, session }),
  ]);

  const coworkersById = new Map(
    taskCoworkers.map((coworker) => [coworker.id, coworker]),
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const agentNameById = buildAgentNameById(agents);
  const validCoworkerIds = new Set(
    taskCoworkers.map((coworker) => coworker.id),
  );
  const activeFilters = {
    ...filters,
    coworkerId:
      filters.coworkerId && validCoworkerIds.has(filters.coworkerId)
        ? filters.coworkerId
        : null,
  };
  const columnPages = await Promise.all(
    KANBAN_COLUMNS.map(async (column) => {
      const page = await getTasksColumnPage({
        columnId: column.id,
        cursor: null,
        limit: TASKS_COLUMN_PAGE_LIMIT,
        scope: activeFilters.scope,
        coworkerId: activeFilters.coworkerId,
        status: activeFilters.status,
        coworkersById,
        agentsById,
      });

      return [column.id, page] as const;
    }),
  );
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
    seedTasksById,
  });

  const coworkerOptions: CoworkerOption[] = getCoworkerOptions(taskCoworkers);
  const initialCreateTaskOpen = create === "true";
  const initialCoworkerId =
    initialCreateTaskOpen && coworkerSlugParam
      ? findCoworkerIdBySlug(coworkerOptions, coworkerSlugParam)
      : null;

  const columnLabels: Record<KanbanColumnId, string> = {
    backlog: tColumns("backlog"),
    todo: tColumns("todo"),
    "in-progress": tColumns("inProgress"),
    "input-required": tColumns("inputRequired"),
    done: tColumns("done"),
  };

  return (
    <div className="w-full px-2">
      <TasksView
        tasks={tasks}
        jobs={jobs}
        jobsNextCursor={jobsPage.nextCursor}
        agentPreviewById={agentPreviewById}
        columnNextCursorById={columnNextCursorById}
        columns={KANBAN_COLUMNS}
        coworkerOptions={coworkerOptions}
        agentNameById={agentNameById}
        userId={session?.user.id ?? null}
        activeOrganizationId={activeOrganizationId}
        initialFilters={activeFilters}
        defaultViewMode={defaultViewMode}
        initialCreateTaskOpen={initialCreateTaskOpen}
        initialCoworkerId={initialCoworkerId}
        createTaskModalResetKey={`${String(initialCreateTaskOpen)}-${initialCoworkerId ?? coworkerSlugParam ?? ""}`}
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
              [TaskStatus.READY]: t("Filters.statusOptions.READY"),
              [TaskStatus.INPUT_REQUIRED]: t(
                "Filters.statusOptions.INPUT_REQUIRED",
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
          },
          listPlaceholder: t("List.placeholder"),
          jobs: {
            filterButton: t("Jobs.filterButton"),
            filterHideFailed: t("Jobs.filterHideFailed"),
            filterShowAll: t("Jobs.filterShowAll"),
            recentTitle: t("Jobs.recentTitle"),
            emptyRecent: t("Jobs.emptyRecent"),
            emptyList: t("Jobs.emptyList"),
            emptySection: t("Jobs.emptySection"),
            untitled: t("Jobs.untitled"),
            unknownAgent: t("Jobs.unknownAgent"),
            unknownCoworker: t("Jobs.unknownCoworker"),
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
