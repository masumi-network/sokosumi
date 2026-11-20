import { TaskStatus } from "@sokosumi/core-client";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { calendarUrl } from "@/app/calendar/calendar-url";
import { TasksPageSkeletonHost } from "@/app/tasks/components/tasks-page-skeleton-host";
import { TasksPendingVendorGrantBannerSlot } from "@/app/tasks/components/tasks-pending-vendor-grant-banner-slot";
import { TasksSearchParamsProvider } from "@/app/tasks/components/tasks-search-params";
import { TasksView } from "@/app/tasks/components/tasks-view";
import {
  KANBAN_COLUMNS,
  type KanbanColumnId,
} from "@/app/tasks/types/task-board";
import {
  firstQueryString,
  hasTasksViewParams,
} from "@/app/tasks/utils/tasks-filters";
import { loadTasksPageData } from "@/app/tasks/utils/tasks-page-data";
import { RefreshPrefetchedPage } from "@/components/refresh-prefetched-page.client";
import {
  parseTasksDensity,
  TASKS_DENSITY_COOKIE_NAME,
} from "@/lib/ui-preferences/tasks-density";
import { parseTasksViewMode } from "@/lib/ui-preferences/tasks-view-mode";
import { getDefaultTasksViewMode } from "@/lib/ui-preferences/tasks-view-mode.server";

interface TasksPageProps {
  searchParams: Promise<{
    create?: string;
    assignee?: string;
    /** @deprecated Use `assignee`. Kept for bookmarked URLs. */
    coworker?: string;
    prompt?: string;
    q?: string | string[];
    scope?: string | string[];
    assigneeId?: string | string[];
    assigneeSokoBotId?: string | string[];
    /** @deprecated Use `assigneeId`. Kept for bookmarked URLs. */
    coworkerId?: string | string[];
    status?: string | string[];
    projectId?: string | string[];
    visibility?: string | string[];
    tag?: string | string[];
    stuck?: string | string[];
    needsMe?: string | string[];
    subtasks?: string | string[];
    mentions?: string | string[];
    sort?: string | string[];
    /** The retired Calendar tab (`tab=calendar`) moved to `/calendar`. */
    tab?: string | string[];
    date?: string;
    view?: string;
    timezone?: string;
    socialOnly?: string;
    types?: string;
    postStatus?: string;
    provider?: string;
    assigneeUserId?: string | string[];
  }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Tasks.Page");

  return {
    title: t("title"),
    description: t("description"),
  };
}

async function TasksPageContent({ searchParams }: TasksPageProps) {
  const resolvedSearchParams = await searchParams;
  if (firstQueryString(resolvedSearchParams.tab) === "calendar") {
    redirect(calendarUrl(resolvedSearchParams));
  }
  const {
    create,
    assignee: assigneeSlugParam,
    coworker: legacyCoworkerSlugParam,
    prompt: promptParam,
    q,
    scope,
    assigneeId,
    assigneeSokoBotId,
    assigneeUserId,
    coworkerId: legacyCoworkerId,
    status,
    projectId,
    visibility,
    tag,
    stuck,
    needsMe,
    mentions,
    sort,
    subtasks,
  } = resolvedSearchParams;
  const [t, tColumns, tDetailActions, cookieStore, defaultViewMode] =
    await Promise.all([
      getTranslations("App.Tasks"),
      getTranslations("App.Tasks.Columns"),
      getTranslations("App.Tasks.Detail.actions"),
      cookies(),
      // `?view=board` (Home's "need your input" link) opens the board even
      // where the list is the saved or device default, without saving it.
      getDefaultTasksViewMode(
        parseTasksViewMode(firstQueryString(resolvedSearchParams.view)),
      ),
    ]);
  const defaultDensity =
    parseTasksDensity(cookieStore.get(TASKS_DENSITY_COOKIE_NAME)?.value) ??
    "normal";
  const initialCreateTaskOpen = create === "true";
  const resolvedAssigneeSlug = assigneeSlugParam ?? legacyCoworkerSlugParam;
  const {
    tasks,
    listNextCursor,
    columnNextCursorById,
    columnHiddenCountById,
    coworkerOptions,
    projectOptions,
    userId,
    activeOrganizationId,
    activeFilters,
    canCreateTask,
    initialAssigneeId,
    parkedTaskCount,
    restoredQuery,
  } = await loadTasksPageData({
    filterParams: {
      q,
      scope,
      assigneeId,
      assigneeSokoBotId,
      assigneeUserId,
      coworkerId: legacyCoworkerId,
      status,
      projectId,
      visibility,
      tag,
      stuck,
      needsMe,
      mentions,
      sort,
      subtasks,
    },
    viewMode: defaultViewMode,
    personalAssistantFallback: t("personalAssistant"),
    createAssigneeSlug: initialCreateTaskOpen
      ? (resolvedAssigneeSlug ?? null)
      : null,
    restoreSavedView: !hasTasksViewParams(resolvedSearchParams),
  });
  const initialProjectId = activeFilters.projectId;

  const columnLabels: Record<KanbanColumnId, string> = {
    backlog: tColumns("backlog"),
    todo: tColumns("todo"),
    "in-progress": tColumns("inProgress"),
    "input-required": tColumns("inputRequired"),
    done: tColumns("done"),
  };

  return (
    <div className="content-in w-full">
      <RefreshPrefetchedPage />
      <Suspense fallback={null}>
        <TasksPendingVendorGrantBannerSlot
          activeOrganizationId={activeOrganizationId}
          parkedTaskCount={parkedTaskCount}
        />
      </Suspense>
      <TasksSearchParamsProvider
        restoredQuery={restoredQuery}
        activeOrganizationId={activeOrganizationId}
      >
        <TasksView
          tasks={tasks}
          listNextCursor={listNextCursor}
          columnNextCursorById={columnNextCursorById}
          columnHiddenCountById={columnHiddenCountById}
          columns={KANBAN_COLUMNS}
          coworkerOptions={coworkerOptions}
          projectOptions={projectOptions}
          userId={userId}
          activeOrganizationId={activeOrganizationId}
          initialFilters={activeFilters}
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
            filters: {
              title: t("Filters.title"),
              searchPlaceholder: t("Filters.searchPlaceholder"),
              emptyResults: t("Filters.emptyResults"),
              all: t("Filters.all"),
              scopeLabel: t("Filters.scopeLabel"),
              scopeOwned: t("Filters.scopeOwned"),
              assignedToMe: t("Filters.assignedToMe"),
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
              commentRequired: tDetailActions("reopenToReadyCommentRequired"),
            },
            display: {
              button: t("Display.button"),
              layout: t("Display.layout"),
              list: t("Display.list"),
              board: t("Display.board"),
              density: t("Display.density"),
              normal: t("Display.normal"),
              compact: t("Display.compact"),
              sortBy: t("Display.sortBy"),
              sortOptions: {
                updatedAt: t("Display.sortOptions.updatedAt"),
                createdAt: t("Display.sortOptions.createdAt"),
                priority: t("Display.sortOptions.priority"),
                dueOn: t("Display.sortOptions.dueOn"),
              },
              showSubtasks: t("Display.showSubtasks"),
            },
            listPlaceholder: t("List.placeholder"),
            loadMore: t("Actions.loadMore"),
          }}
        />
      </TasksSearchParamsProvider>
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
