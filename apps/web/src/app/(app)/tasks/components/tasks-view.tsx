"use client";

import { DndContext, DragOverlay } from "@dnd-kit/core";
import type { TaskStatus } from "@sokosumi/core-client";
import { makeUserTasksChannelName } from "@sokosumi/utils";
import { ChannelProvider, useChannel } from "ably/react";
import { useQueryState } from "nuqs";
import { useMemo, useRef } from "react";
import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import { TASKS_TOOLBAR_ROW_CLASS } from "@/app/tasks/constants";
import {
  KANBAN_COLUMNS,
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import { COLUMN_MAIN_STATUS } from "@/app/tasks/utils/task-column";
import {
  effectiveTasksSort,
  type TasksSort,
} from "@/app/tasks/utils/task-sort";
import {
  buildTasksFiltersSearchParams,
  clearTasksFilters,
  hasClearableTasksFilters,
  type ProjectFilterOption,
  type TasksFilters,
} from "@/app/tasks/utils/tasks-filters";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import { OrganizationSeatContext } from "@/contexts/organization-seat-context";
import { getRealtimeChannelEnvironment } from "@/lib/ably/realtime-channel-environment";
import { type TaskEventData, taskEventDataSchema } from "@/lib/ably/schema";
import type { CoworkerOption } from "@/lib/types/coworker";
import type { TasksDensity } from "@/lib/ui-preferences/tasks-density";
import type { TasksViewMode } from "@/lib/ui-preferences/tasks-view-mode";
import { cn } from "@/lib/utils";
import { CreateTaskModal, CreateTaskModalProvider } from "./create-task-modal";
import { KanbanBoard } from "./kanban-board";
import { TaskCard } from "./task-card";
import { isTaskDnDDraggable } from "./task-dnd";
import { TaskListItem } from "./task-list-item";
import { TaskListView } from "./task-list-view";
import { ShowOpenSubtasksContext } from "./task-open-subtasks";
import { TaskReopenToReadyDialog } from "./task-reopen-to-ready-dialog";
import { TaskTagCatalogProvider } from "./task-tag-catalog";
import { TasksMobileCreateFabSlot } from "./tasks-mobile-create-fab-slot";
import { replaceTasksQuery } from "./tasks-search-params";
import { focusToolbarControl } from "./tasks-view-filters";
import { TasksViewToolbarActions } from "./tasks-view-toolbar-actions";
import { TasksKeyboard } from "./use-board-keyboard";
import {
  type TasksBoardModelProps,
  useTasksBoardModel,
  useTasksViewShell,
} from "./use-tasks-view-model";

interface TasksRealtimeListenerProps {
  userId: string;
  onEvent: (data: TaskEventData) => void;
}

function TasksRealtimeListener({
  userId,
  onEvent,
}: TasksRealtimeListenerProps) {
  useChannel(
    makeUserTasksChannelName(userId, getRealtimeChannelEnvironment()),
    (message) => {
      const parsedResult = taskEventDataSchema.safeParse(message.data);
      if (parsedResult.success) {
        onEvent(parsedResult.data);
      } else {
        console.error(
          "Failed to parse TaskEventData from message",
          message,
          parsedResult.error,
        );
      }
    },
  );

  return null;
}

// Only the URL changes: Core already sends each Task's open sub-tasks, so a
// display switch needs no server reload. Next keeps useSearchParams in step.
const URL_ONLY_NAVIGATOR = {
  replace: (href: string) => window.history.replaceState(null, "", href),
};
export interface TasksViewProps {
  tasks: TaskWithCoworker[];
  listNextCursor: string | null;
  columnNextCursorById: Record<KanbanColumnId, string | null>;
  /** Tasks past the loaded pages of each column, counted in its header. */
  columnHiddenCountById: Record<KanbanColumnId, number>;
  columns?: KanbanColumnDefinition[];
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
  userId?: string | null;
  activeOrganizationId: string | null;
  initialFilters: TasksFilters;
  defaultViewMode?: TasksViewMode;
  defaultDensity?: TasksDensity;
  initialCreateTaskOpen?: boolean;
  initialAssigneeId?: string | null;
  initialCreateTaskPrompt?: string | null;
  createTaskModalResetKey?: string;
  canCreateTask?: boolean;
  labels: {
    filters: {
      title: string;
      searchPlaceholder: string;
      emptyResults: string;
      all: string;
      scopeLabel: string;
      scopeOwned: string;
      assignedToMe: string;
      scopeWorkspace: string;
      coworkerLabel: string;
      statusLabel: string;
      visibilityLabel: string;
      visibilityPrivate: string;
      statusOptions: Record<TaskStatus, string>;
    };
    columns: Record<KanbanColumnId, string>;
    display: {
      button: string;
      layout: string;
      sortBy: string;
      sortOptions: Record<TasksSort, string>;
      showSubtasks: string;
      list: string;
      board: string;
      density: string;
      normal: string;
      compact: string;
    };
    listPlaceholder: string;
    loadMore: string;
    dragError: string;
    loadMoreError: string;
    reopenToReady: { commentRequired: string };
  };
}

interface TasksBoardProps extends TasksBoardModelProps {
  activeOrganizationId: string | null;
  canCreateTask: boolean;
  density: TasksDensity;
  shownSort: TasksSort;
  onClearFilters: () => void;
  onClearSearch: () => void;
}

function TasksBoard(props: TasksBoardProps) {
  const {
    columns = KANBAN_COLUMNS,
    activeOrganizationId,
    canCreateTask,
    labels,
    routeFilters,
    viewMode,
    density,
    shownSort,
    isTaskPaginationInSync,
    onClearFilters,
    onClearSearch,
  } = props;
  const {
    tTasks,
    shownItems,
    columnCursorById,
    columnHiddenById,
    listCursor,
    isLoadingListMore,
    loadingColumnIds,
    activeDragRect,
    pendingBoardReopen,
    reopenComment,
    setReopenComment,
    isReopenPending,
    isMounted,
    sensors,
    handleDragStart,
    handleDragCancel,
    handleDragEnd,
    handleBoardReopenOpenChange,
    handleBoardReopenConfirm,
    handleLoadMoreColumn,
    handleLoadMoreList,
    activeDragTask,
  } = useTasksBoardModel(props);

  const columnFooterById = useMemo<
    Partial<Record<KanbanColumnId, React.ReactNode>>
  >(() => {
    const footerById: Partial<Record<KanbanColumnId, React.ReactNode>> = {};

    for (const column of columns) {
      const cursor = columnCursorById[column.id] ?? null;
      if (cursor === null) continue;
      const isLoading = loadingColumnIds.has(column.id);
      footerById[column.id] = (
        <div className="flex justify-center pb-2">
          <Button
            className="text-muted-foreground hover:text-foreground w-full text-xs"
            variant="outline"
            onClick={() => void handleLoadMoreColumn(column.id)}
            loading={isLoading}
            disabled={!isTaskPaginationInSync}
          >
            {labels.loadMore}
          </Button>
        </div>
      );
    }

    return footerById;
  }, [
    columnCursorById,
    columns,
    handleLoadMoreColumn,
    isTaskPaginationInSync,
    labels.loadMore,
    loadingColumnIds,
  ]);

  const listFooter = useMemo(() => {
    if (listCursor === null) return null;

    return (
      <div className="flex justify-center pb-2">
        <Button
          className="text-muted-foreground hover:text-foreground w-full text-xs"
          variant="outline"
          onClick={() => void handleLoadMoreList()}
          loading={isLoadingListMore}
          disabled={!isTaskPaginationInSync}
        >
          {labels.loadMore}
        </Button>
      </div>
    );
  }, [
    handleLoadMoreList,
    isLoadingListMore,
    isTaskPaginationInSync,
    labels.loadMore,
    listCursor,
  ]);

  // Only once the server answered for these filters, so a stale board never says "no match".
  const showFilteredEmpty =
    shownItems.length === 0 &&
    isTaskPaginationInSync &&
    hasClearableTasksFilters(routeFilters, activeOrganizationId);
  // A search alone names what was typed, not "these filters".
  const emptySearch =
    routeFilters.search &&
    !hasClearableTasksFilters(
      { ...routeFilters, search: undefined },
      activeOrganizationId,
    )
      ? routeFilters.search
      : null;

  return (
    <>
      {/* Only the board fades in: the loading shell already drew the toolbar. */}
      <div
        className={cn(
          "content-in flex min-h-0 flex-1 flex-col gap-4",
          viewMode === "board" ? "max-h-[calc(100dvh-150px)]" : "max-h-full",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div
            className={cn(
              viewMode === "board" ? "flex min-h-0 min-w-0 flex-1" : "",
            )}
          >
            {showFilteredEmpty ? (
              <div className="bg-card-background flex flex-1 items-center justify-center rounded-xl">
                {emptySearch ? (
                  <EmptyState
                    title={tTasks("Filters.noSearchMatchesTitle")}
                    description={tTasks("Filters.noSearchMatchesDescription", {
                      query: emptySearch,
                    })}
                    descriptionClassName="wrap-anywhere"
                    action={
                      <Button variant="outline" onClick={onClearSearch}>
                        {tTasks("Filters.clearSearch")}
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    title={tTasks("Filters.noMatchesTitle")}
                    description={tTasks("Filters.noMatchesDescription")}
                    action={
                      <Button variant="outline" onClick={onClearFilters}>
                        {tTasks("Filters.clear")}
                      </Button>
                    }
                  />
                )}
              </div>
            ) : isMounted ? (
              <DndContext
                sensors={sensors}
                onDragStart={handleDragStart}
                onDragCancel={handleDragCancel}
                onDragEnd={handleDragEnd}
              >
                {viewMode === "board" ? (
                  <KanbanBoard
                    tasks={shownItems}
                    columns={columns}
                    columnHiddenCountById={columnHiddenById}
                    columnFooterById={columnFooterById}
                    compact={density === "compact"}
                    statusLabels={labels.filters.statusOptions}
                    sort={shownSort}
                    preserveSearchOrder={Boolean(routeFilters.search)}
                    canDragTask={(task) =>
                      canCreateTask && isTaskDnDDraggable(task)
                    }
                    labels={{
                      columns: labels.columns,
                      emptyColumn: labels.listPlaceholder,
                    }}
                  />
                ) : (
                  <TaskListView
                    tasks={shownItems}
                    footer={listFooter}
                    compact={density === "compact"}
                    statusLabels={labels.filters.statusOptions}
                    labels={{
                      emptyList: labels.listPlaceholder,
                    }}
                  />
                )}
                <DragOverlay>
                  {activeDragTask ? (
                    <div
                      className="pointer-events-none"
                      style={{
                        width: activeDragRect?.width,
                        height: activeDragRect?.height,
                      }}
                    >
                      {viewMode === "board" ? (
                        <TaskCard
                          task={activeDragTask}
                          quietStatus={
                            COLUMN_MAIN_STATUS[activeDragTask.columnId]
                          }
                          compact={density === "compact"}
                          statusLabels={labels.filters.statusOptions}
                        />
                      ) : (
                        <TaskListItem
                          task={activeDragTask}
                          isOverlay
                          compact={density === "compact"}
                          statusLabels={labels.filters.statusOptions}
                        />
                      )}
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            ) : viewMode === "board" ? (
              <KanbanBoard
                tasks={shownItems}
                columns={columns}
                columnHiddenCountById={columnHiddenById}
                columnFooterById={columnFooterById}
                compact={density === "compact"}
                statusLabels={labels.filters.statusOptions}
                sort={shownSort}
                preserveSearchOrder={Boolean(routeFilters.search)}
                labels={{
                  columns: labels.columns,
                  emptyColumn: labels.listPlaceholder,
                }}
                isDragEnabled={false}
              />
            ) : (
              <TaskListView
                tasks={shownItems}
                footer={listFooter}
                compact={density === "compact"}
                statusLabels={labels.filters.statusOptions}
                labels={{
                  emptyList: labels.listPlaceholder,
                }}
              />
            )}
          </div>
        </div>
      </div>
      <TaskReopenToReadyDialog
        open={pendingBoardReopen != null}
        onOpenChange={handleBoardReopenOpenChange}
        assigneeName={pendingBoardReopen?.assigneeName ?? ""}
        comment={reopenComment}
        onCommentChange={setReopenComment}
        onConfirm={handleBoardReopenConfirm}
        isPending={isReopenPending}
      />
    </>
  );
}

export function TasksView(props: TasksViewProps) {
  const {
    tasks,
    listNextCursor,
    columnNextCursorById,
    columnHiddenCountById,
    columns = KANBAN_COLUMNS,
    coworkerOptions,
    projectOptions,
    userId,
    activeOrganizationId,
    initialFilters,
    defaultViewMode,
    initialCreateTaskOpen = false,
    initialAssigneeId = null,
    initialCreateTaskPrompt = null,
    createTaskModalResetKey = "default",
    canCreateTask = false,
    labels,
  } = props;
  const {
    router,
    pathname,
    searchParams,
    routeFilters,
    viewMode,
    density,
    defaultProjectId,
    serverTasksFiltersResetKey,
    isTaskPaginationInSync,
    handleEventUpdate,
    handleViewModeChange,
    handleDensityChange,
  } = useTasksViewShell(props);

  const shownSort = effectiveTasksSort(routeFilters.sort, viewMode);
  const replaceRouteFilters = (
    patch: Partial<TasksFilters>,
    navigator: { replace: (href: string) => void } = router,
  ) => {
    replaceTasksQuery(
      navigator,
      pathname,
      buildTasksFiltersSearchParams(searchParams, {
        ...routeFilters,
        ...patch,
      }),
      activeOrganizationId,
    );
  };

  const toolbarRef = useRef<HTMLDivElement>(null);
  const [, setSearchQuery] = useQueryState("q", { shallow: false });
  const handleClearFilters = () => {
    replaceTasksQuery(
      router,
      pathname,
      buildTasksFiltersSearchParams(
        searchParams,
        clearTasksFilters(routeFilters, activeOrganizationId),
      ),
      activeOrganizationId,
    );
    focusToolbarControl(toolbarRef.current);
  };
  // The search field keeps its text in nuqs `q`, which a router.replace does
  // not reach, so Clear search empties it there. It unmounts itself: the
  // keyboard goes straight back to the field.
  const handleClearSearch = () => {
    void setSearchQuery(null);
    toolbarRef.current
      ?.querySelector<HTMLInputElement>('input[type="search"]')
      ?.focus();
  };

  const content = (
    <div
      className={cn(
        "flex h-full min-h-0 flex-1 flex-col gap-5",
        LIST_MOBILE_CREATE_FAB_CLEARANCE,
      )}
    >
      <div ref={toolbarRef} className={TASKS_TOOLBAR_ROW_CLASS}>
        <TasksViewToolbarActions
          filters={{
            activeOrganizationId,
            userId,
            coworkerOptions,
            projectOptions,
            labels: { ...labels.filters, columns: labels.columns },
          }}
          display={{
            value: viewMode,
            onChange: handleViewModeChange,
            density,
            onDensityChange: handleDensityChange,
            sort: shownSort,
            onSortChange: (sort) => replaceRouteFilters({ sort }),
            showSubtasks: routeFilters.subtasks === true,
            onShowSubtasksChange: (subtasks) =>
              replaceRouteFilters({ subtasks }, URL_ONLY_NAVIGATOR),
            labels: labels.display,
          }}
          exportFilters={{ ...routeFilters, sort: shownSort }}
        />
      </div>

      <TasksBoard
        key={serverTasksFiltersResetKey}
        tasks={tasks}
        listNextCursor={listNextCursor}
        columnNextCursorById={columnNextCursorById}
        columnHiddenCountById={columnHiddenCountById}
        columns={columns}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        activeOrganizationId={activeOrganizationId}
        initialFilters={initialFilters}
        defaultViewMode={defaultViewMode}
        canCreateTask={canCreateTask}
        labels={labels}
        routeFilters={routeFilters}
        viewMode={viewMode}
        density={density}
        shownSort={shownSort}
        serverTasksFiltersResetKey={serverTasksFiltersResetKey}
        isTaskPaginationInSync={isTaskPaginationInSync}
        onClearFilters={handleClearFilters}
        onClearSearch={handleClearSearch}
      />
    </div>
  );

  return (
    <TaskTagCatalogProvider organizationId={activeOrganizationId}>
      {userId ? (
        <LazyAblyProvider>
          <ChannelProvider
            channelName={makeUserTasksChannelName(
              userId,
              getRealtimeChannelEnvironment(),
            )}
          >
            <TasksRealtimeListener
              userId={userId}
              onEvent={handleEventUpdate}
            />
          </ChannelProvider>
        </LazyAblyProvider>
      ) : null}
      {/* The page's seat check is fresher than the layout's after a soft navigation. */}
      <OrganizationSeatContext value={canCreateTask}>
        <TasksKeyboard />
        <ShowOpenSubtasksContext value={routeFilters.subtasks === true}>
          {content}
        </ShowOpenSubtasksContext>
      </OrganizationSeatContext>
      <CreateTaskModalProvider
        key={createTaskModalResetKey}
        initialOpen={initialCreateTaskOpen}
        initialAssigneeId={initialAssigneeId}
        initialPrompt={initialCreateTaskPrompt}
        initialProjectId={defaultProjectId}
      >
        {canCreateTask ? <TasksMobileCreateFabSlot /> : null}
        <CreateTaskModal
          coworkerOptions={coworkerOptions}
          projectOptions={projectOptions}
          defaultProjectId={defaultProjectId}
          initialCreateTaskOpen={initialCreateTaskOpen}
        />
      </CreateTaskModalProvider>
    </TaskTagCatalogProvider>
  );
}
