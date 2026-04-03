import {
  AgentJobStatus,
  type MemberWithUser,
  TaskStatus,
} from "@sokosumi/database";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { TasksView } from "@/app/tasks/components/tasks-view";
import { buildAgentNameById } from "@/app/tasks/utils/agent-names";
import {
  findCoworkerIdBySlug,
  getCoworkerOptions,
} from "@/app/tasks/utils/coworker-options";
import { mapJobsToTasksViewData } from "@/app/tasks/utils/jobs-view-data";
import {
  buildMemberFilterOptions,
  buildMemberPreviewItems,
} from "@/app/tasks/utils/member-filter-options";
import { getTasksColumnPage } from "@/app/tasks/utils/tasks-column-page";
import { parseTasksRouteFilters } from "@/app/tasks/utils/tasks-filters";
import { TASKS_COLUMN_PAGE_LIMIT } from "@/app/tasks/utils/tasks-pagination";
import { getSession } from "@/lib/auth/utils";
import { agentService, organizationService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";
import { userService } from "@/lib/services/user.service";
import type { CoworkerOption } from "@/lib/types/coworker";
import { KANBAN_COLUMNS, type KanbanColumnId } from "@/lib/types/task";
import {
  parseTasksViewMode,
  TASKS_VIEW_MODE_COOKIE_NAME,
} from "@/lib/ui-preferences/tasks-view-mode";

interface TasksPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata = {
  title: "Task Manager",
};

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const rawSearchParams = await searchParams;
  const { create, coworker: coworkerSlugParam } = rawSearchParams;
  const initialCoworkerSlug = Array.isArray(coworkerSlugParam)
    ? (coworkerSlugParam[0] ?? null)
    : (coworkerSlugParam ?? null);
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
  const parsedFilters = parseTasksRouteFilters(rawSearchParams);

  const [taskCoworkers, agents, organizationMembers] = await Promise.all([
    coworkerService.listCoworkers("tasks"),
    agentService.getAvailableAgentsWithCreditsPrice(),
    activeOrganizationId
      ? organizationService.getOrganizationMembersWithUser(activeOrganizationId)
      : Promise.resolve([] as MemberWithUser[]),
  ]);

  const coworkersById = new Map(
    taskCoworkers.map((coworker) => [coworker.id, coworker]),
  );
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const agentPreviewSeedById = new Map(
    agents.map((agent) => [
      agent.id,
      {
        name: agent.name,
        icon: agent.icon ?? null,
      },
    ]),
  );
  const agentNameById = buildAgentNameById(agents);
  const coworkerOptions: CoworkerOption[] = getCoworkerOptions(taskCoworkers);
  const memberOptions = activeOrganizationId
    ? buildMemberFilterOptions(
        organizationMembers,
        session?.user.id ?? "",
        t("Filters.memberMe"),
        session?.user.image ?? null,
      )
    : [];
  const memberPreviews = buildMemberPreviewItems(
    organizationMembers,
    session?.user
      ? {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          image: session.user.image,
        }
      : null,
  );
  const memberPreviewByUserId = new Map(
    memberPreviews.map((member) => [
      member.id,
      {
        name: member.name,
        image: member.image,
      },
    ]),
  );
  const validMemberIds = new Set(memberOptions.map((member) => member.id));
  const validCoworkerIds = new Set(
    coworkerOptions.map((coworker) => coworker.id),
  );
  const validAgentIds = new Set(agents.map((agent) => agent.id));
  const activeFilters = {
    ...parsedFilters,
    taskStatus: parsedFilters.taskStatus,
    jobStatus: parsedFilters.jobStatus,
    memberId:
      activeOrganizationId && parsedFilters.memberId
        ? validMemberIds.has(parsedFilters.memberId)
          ? parsedFilters.memberId
          : null
        : null,
    coworkerId: parsedFilters.coworkerId
      ? validCoworkerIds.has(parsedFilters.coworkerId)
        ? parsedFilters.coworkerId
        : null
      : null,
    agentId: parsedFilters.agentId
      ? validAgentIds.has(parsedFilters.agentId)
        ? parsedFilters.agentId
        : null
      : null,
  };
  const [jobsPage, columnPages] = await Promise.all([
    userService.listMyJobsForActiveContextPaginated({
      limit: 20,
      session,
      memberId: activeFilters.memberId,
      agentId: activeFilters.agentId,
      status: activeFilters.jobStatus,
      includeFailed: activeFilters.jobStatus === null ? false : null,
    }),
    Promise.all(
      KANBAN_COLUMNS.map(async (column) => {
        const page = await getTasksColumnPage({
          columnId: column.id,
          cursor: null,
          limit: TASKS_COLUMN_PAGE_LIMIT,
          memberId: activeFilters.memberId,
          coworkerId: activeFilters.coworkerId,
          agentId: activeFilters.agentId,
          taskStatus: activeFilters.taskStatus,
          coworkersById,
          agentsById,
        });

        return [column.id, page] as const;
      }),
    ),
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
    memberPreviewByUserId,
    agentPreviewSeedById,
    seedTasksById,
  });
  const allAgentPreviewById = {
    ...Object.fromEntries(agentPreviewSeedById),
    ...agentPreviewById,
  };
  const initialCreateTaskOpen =
    (Array.isArray(create) ? create[0] : create) === "true";
  const initialCoworkerId =
    initialCreateTaskOpen && initialCoworkerSlug
      ? findCoworkerIdBySlug(coworkerOptions, initialCoworkerSlug)
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
        agentPreviewById={allAgentPreviewById}
        columnNextCursorById={columnNextCursorById}
        columns={KANBAN_COLUMNS}
        coworkerOptions={coworkerOptions}
        memberOptions={memberOptions}
        memberPreviews={memberPreviews}
        agentNameById={agentNameById}
        userId={session?.user.id ?? null}
        activeOrganizationId={activeOrganizationId}
        defaultViewMode={defaultViewMode}
        initialFilters={activeFilters}
        initialCreateTaskOpen={initialCreateTaskOpen}
        initialCoworkerId={initialCoworkerId}
        createTaskModalResetKey={`${String(initialCreateTaskOpen)}-${initialCoworkerId ?? initialCoworkerSlug ?? ""}`}
        labels={{
          tabs: {
            tasks: t("Tabs.tasks"),
            jobs: t("Tabs.jobs"),
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
            recentTitle: t("Jobs.recentTitle"),
            emptyRecent: t("Jobs.emptyRecent"),
            emptyList: t("Jobs.emptyList"),
            emptySection: t("Jobs.emptySection"),
            untitled: t("Jobs.untitled"),
            unknownAgent: t("Jobs.unknownAgent"),
            unknownCoworker: t("Jobs.unknownCoworker"),
          },
          filters: {
            all: t("Filters.all"),
            title: t("Filters.title"),
            member: t("Filters.member"),
            memberMe: t("Filters.memberMe"),
            coworker: t("Filters.coworker"),
            agent: t("Filters.agent"),
            taskStatus: t("Filters.taskStatus"),
            jobStatus: t("Filters.jobStatus"),
            searchPlaceholder: t("Filters.searchPlaceholder"),
            emptyResults: t("Filters.emptyResults"),
            taskStatusOptions: {
              [TaskStatus.DRAFT]: t("Filters.taskStatusOptions.DRAFT"),
              [TaskStatus.READY]: t("Filters.taskStatusOptions.READY"),
              [TaskStatus.INPUT_REQUIRED]: t(
                "Filters.taskStatusOptions.INPUT_REQUIRED",
              ),
              [TaskStatus.AUTHENTICATION_REQUIRED]: t(
                "Filters.taskStatusOptions.AUTHENTICATION_REQUIRED",
              ),
              [TaskStatus.OUT_OF_CREDITS]: t(
                "Filters.taskStatusOptions.OUT_OF_CREDITS",
              ),
              [TaskStatus.CREDITS_TOPPED_UP]: t(
                "Filters.taskStatusOptions.CREDITS_TOPPED_UP",
              ),
              [TaskStatus.RUNNING]: t("Filters.taskStatusOptions.RUNNING"),
              [TaskStatus.AWAITING_EXTERNAL]: t(
                "Filters.taskStatusOptions.AWAITING_EXTERNAL",
              ),
              [TaskStatus.COMPLETED]: t("Filters.taskStatusOptions.COMPLETED"),
              [TaskStatus.FAILED]: t("Filters.taskStatusOptions.FAILED"),
              [TaskStatus.CANCEL_REQUESTED]: t(
                "Filters.taskStatusOptions.CANCEL_REQUESTED",
              ),
              [TaskStatus.CANCELED]: t("Filters.taskStatusOptions.CANCELED"),
            },
            jobStatusOptions: {
              [AgentJobStatus.INITIATED]: t(
                "Filters.jobStatusOptions.INITIATED",
              ),
              [AgentJobStatus.AWAITING_PAYMENT]: t(
                "Filters.jobStatusOptions.AWAITING_PAYMENT",
              ),
              [AgentJobStatus.AWAITING_INPUT]: t(
                "Filters.jobStatusOptions.AWAITING_INPUT",
              ),
              [AgentJobStatus.RUNNING]: t("Filters.jobStatusOptions.RUNNING"),
              [AgentJobStatus.COMPLETED]: t(
                "Filters.jobStatusOptions.COMPLETED",
              ),
              [AgentJobStatus.FAILED]: t("Filters.jobStatusOptions.FAILED"),
            },
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
