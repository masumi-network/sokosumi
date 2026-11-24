"use client";

import {
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { TaskStatus } from "@sokosumi/core-client";
import {
  CORE_API_ERROR_KINDS,
  userTaskStatusTransitionRequiresComment,
} from "@sokosumi/utils";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { toast } from "sonner";
import { loadMoreTasksColumn, loadMoreTasksList } from "@/app/tasks/actions";
import {
  KANBAN_COLUMNS,
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import { isTaskArchived } from "@/app/tasks/utils/archived-task-ids";
import { mergeTasksOnServerRefresh } from "@/app/tasks/utils/merge-tasks-on-server-refresh";
import { buildPendingTask } from "@/app/tasks/utils/pending-created-task";
import {
  appendUniqueTasks,
  buildInitialColumnCursorById,
} from "@/app/tasks/utils/task-pages";
import { effectiveTasksSort } from "@/app/tasks/utils/task-sort";
import {
  getTasksFiltersFromSearchParams,
  getTasksFiltersResetKey,
} from "@/app/tasks/utils/tasks-filters";
import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { usePendingCreatedTasks } from "@/hooks/effects/use-pending-created-tasks";
import { useRefreshWhenShown } from "@/hooks/effects/use-refresh-when-shown";
import type { TaskEventData } from "@/lib/ably/schema";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";
import {
  serializeTasksDensityCookie,
  type TasksDensity,
} from "@/lib/ui-preferences/tasks-density";
import {
  serializeTasksViewModeCookie,
  type TasksViewMode,
} from "@/lib/ui-preferences/tasks-view-mode";
import type { TaskMutationErrorKind } from "@/lib/utils/task-mutation-error-kinds";
import { shouldRollbackBoardReopenOnDismiss } from "./task-board-reopen";
import {
  isDnDDragColumn,
  isDnDDropColumn,
  isTaskDnDDraggable,
  statusForColumn,
} from "./task-dnd";
import { useTasksSearchParams } from "./tasks-search-params";
import type { TasksViewProps } from "./tasks-view";

interface BoardRequestContext {
  readonly filtersKey: string;
  readonly defaultViewMode: TasksViewMode | undefined;
  readonly viewMode: TasksViewMode;
}

interface MergedRefreshSnapshot {
  readonly tasks: TaskWithCoworker[];
  readonly columns: KanbanColumnDefinition[];
  readonly defaultViewMode: TasksViewMode | undefined;
  readonly initialColumnNextCursorById: Record<KanbanColumnId, string | null>;
  readonly initialColumnHiddenCountById: Record<KanbanColumnId, number>;
  readonly initialListNextCursor: string | null;
}

interface TasksBoardState {
  context: BoardRequestContext;
  items: TaskWithCoworker[];
  columnCursorById: Record<KanbanColumnId, string | null>;
  columnHiddenById: Record<KanbanColumnId, number>;
  listCursor: string | null;
  loadingColumnIds: Set<KanbanColumnId>;
  isLoadingListMore: boolean;
  loadedBoardTaskIds: ReadonlySet<string>;
  lastMergedRefresh: MergedRefreshSnapshot | null;
}

interface PendingBoardReopen {
  taskId: string;
  assigneeName: string;
  fromColumn: KanbanColumnId;
  toColumn: KanbanColumnId;
  previousStatus: TaskStatus;
  previousStatusSince: string | undefined;
  desiredStatus: TaskStatus;
  context: BoardRequestContext;
  moveToken: object;
}

function createBoardState({
  context,
  tasks,
  columns,
  initialColumnNextCursorById,
  initialColumnHiddenCountById,
  initialListNextCursor,
}: {
  context: BoardRequestContext;
  tasks: TaskWithCoworker[];
  columns: KanbanColumnDefinition[];
  initialColumnNextCursorById: Record<KanbanColumnId, string | null>;
  initialColumnHiddenCountById: Record<KanbanColumnId, number>;
  initialListNextCursor: string | null;
}): TasksBoardState {
  return {
    context,
    items: tasks,
    columnCursorById: buildInitialColumnCursorById(
      columns,
      initialColumnNextCursorById,
    ),
    columnHiddenById: initialColumnHiddenCountById,
    listCursor: initialListNextCursor,
    loadingColumnIds: new Set(),
    isLoadingListMore: false,
    loadedBoardTaskIds: new Set(),
    lastMergedRefresh: null,
  };
}

function getContextPendingMoves(
  map: WeakMap<BoardRequestContext, Map<string, object>>,
  context: BoardRequestContext,
): Map<string, object> {
  let pendingMoves = map.get(context);
  if (!pendingMoves) {
    pendingMoves = new Map<string, object>();
    map.set(context, pendingMoves);
  }
  return pendingMoves;
}

function getContextLoadingColumns(
  map: WeakMap<BoardRequestContext, Set<KanbanColumnId>>,
  context: BoardRequestContext,
): Set<KanbanColumnId> {
  let loadingColumns = map.get(context);
  if (!loadingColumns) {
    loadingColumns = new Set<KanbanColumnId>();
    map.set(context, loadingColumns);
  }
  return loadingColumns;
}

const hydrationStore = (() => {
  let isHydrated = false;
  const listeners = new Set<() => void>();

  function notify() {
    listeners.forEach((listener) => listener());
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    if (!isHydrated && typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        if (isHydrated) return;
        isHydrated = true;
        notify();
      });
    }
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot() {
    return isHydrated;
  }

  function getServerSnapshot() {
    return false;
  }

  return { subscribe, getSnapshot, getServerSnapshot };
})();

export function useTasksViewModel({
  tasks,
  listNextCursor: initialListNextCursor,
  columnNextCursorById: initialColumnNextCursorById,
  columnHiddenCountById: initialColumnHiddenCountById,
  columns = KANBAN_COLUMNS,
  coworkerOptions,
  projectOptions,
  activeOrganizationId,
  initialFilters,
  defaultViewMode,
  defaultDensity,
  labels,
}: TasksViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { showCalendarClientUpgradeModal } = useGlobalModalsContext();
  const searchParams = useTasksSearchParams();
  const tTasks = useTranslations("App.Tasks");
  /**
   * The board already restored the card by the time this runs. A refused move
   * gets the status error; only a stale client gets the reload modal.
   */
  const reportDragRejection = (kind: TaskMutationErrorKind) => {
    if (kind === CORE_API_ERROR_KINDS.STATUS_NOT_SELECTABLE) {
      toast.error(tTasks("Errors.updateStatus"));
      return;
    }
    showCalendarClientUpgradeModal();
  };
  const routeFilters = useMemo(
    () =>
      getTasksFiltersFromSearchParams(
        searchParams,
        activeOrganizationId,
        coworkerOptions,
        projectOptions,
      ),
    [activeOrganizationId, coworkerOptions, projectOptions, searchParams],
  );
  const [density, setDensity] = useState<TasksDensity>(
    defaultDensity ?? "normal",
  );
  const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null);
  const [activeDragRect, setActiveDragRect] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [pendingBoardReopen, setPendingBoardReopen] =
    useState<PendingBoardReopen | null>(null);
  const [reopenComment, setReopenComment] = useState("");
  const [isReopenPending, startReopenTransition] = useTransition();
  const isMounted = useSyncExternalStore(
    hydrationStore.subscribe,
    hydrationStore.getSnapshot,
    hydrationStore.getServerSnapshot,
  );
  const pendingMovesByContextRef = useRef(
    new WeakMap<BoardRequestContext, Map<string, object>>(),
  );
  const loadingColumnIdsByContextRef = useRef(
    new WeakMap<BoardRequestContext, Set<KanbanColumnId>>(),
  );
  const loadingListContextsRef = useRef(new WeakSet<BoardRequestContext>());
  const refreshRoute = useRefreshWhenShown(() => router.refresh());

  const serverTasksFiltersResetKey = useMemo(
    () => getTasksFiltersResetKey(initialFilters, activeOrganizationId),
    [activeOrganizationId, initialFilters],
  );
  const routeTasksFiltersResetKey = useMemo(
    () => getTasksFiltersResetKey(routeFilters, activeOrganizationId),
    [activeOrganizationId, routeFilters],
  );
  const defaultProjectId = routeFilters.projectId;

  const isTaskPaginationInSync =
    routeTasksFiltersResetKey === serverTasksFiltersResetKey;

  const [boardState, setBoardState] = useState<TasksBoardState>(() =>
    createBoardState({
      context: {
        filtersKey: serverTasksFiltersResetKey,
        defaultViewMode,
        viewMode: defaultViewMode ?? "board",
      },
      tasks,
      columns,
      initialColumnNextCursorById,
      initialColumnHiddenCountById,
      initialListNextCursor,
    }),
  );

  // Reset in render so filter or view changes while hidden under React
  // <Activity> still replace the request-identity object and board state.
  const filtersChanged =
    boardState.context.filtersKey !== serverTasksFiltersResetKey;
  const defaultViewModeChanged =
    boardState.context.defaultViewMode !== defaultViewMode;
  if (filtersChanged || defaultViewModeChanged) {
    setBoardState(
      createBoardState({
        context: {
          filtersKey: serverTasksFiltersResetKey,
          defaultViewMode,
          viewMode: defaultViewModeChanged
            ? (defaultViewMode ?? "board")
            : boardState.context.viewMode,
        },
        tasks,
        columns,
        initialColumnNextCursorById,
        initialColumnHiddenCountById,
        initialListNextCursor,
      }),
    );
    if (pendingBoardReopen !== null) {
      setPendingBoardReopen(null);
    }
    if (reopenComment !== "") {
      setReopenComment("");
    }
  }

  const {
    context: requestContext,
    items,
    columnCursorById,
    columnHiddenById,
    listCursor,
    loadingColumnIds,
    isLoadingListMore,
  } = boardState;
  const viewMode = requestContext.viewMode;

  const currentContextRef = useRef(requestContext);
  const itemsRef = useRef(items);
  const columnCursorByIdRef = useRef(columnCursorById);
  const listCursorRef = useRef(listCursor);
  if (!filtersChanged && !defaultViewModeChanged) {
    currentContextRef.current = requestContext;
    itemsRef.current = items;
    columnCursorByIdRef.current = columnCursorById;
    listCursorRef.current = listCursor;
  }
  // Drag, merge and paging keep reading `items`: a pending row is display only.
  const itemsWithPending = usePendingCreatedTasks(
    items,
    useCallback(
      (input) => buildPendingTask(input, { coworkerOptions, projectOptions }),
      [coworkerOptions, projectOptions],
    ),
  );
  // A pending row has no confirmed tags. Core supplies the matching row on save.
  // Needs me shows only Tasks that wait for a person, and a new Task does not.
  // Mentions shows only Tasks with a mention, and a new Task has none.
  const shownItems =
    routeFilters.search ||
    routeFilters.tag ||
    routeFilters.needsMe ||
    routeFilters.mentions
      ? items
      : itemsWithPending;

  const handleEventUpdate = (_data: TaskEventData) => {
    refreshRoute();
  };

  // Before paint: the commit that brings new rows also drops a pending row,
  // and the board must not show a frame without either.
  useLayoutEffect(() => {
    const isListView = defaultViewMode === "list";
    const keepLocalOnlyTasks =
      !isListView &&
      !initialFilters.search &&
      !initialFilters.tag &&
      !initialFilters.needsMe &&
      !initialFilters.mentions;
    const serverTasks = tasks.filter((task) => !isTaskArchived(task.id));
    const serverTaskIds = new Set(serverTasks.map((task) => task.id));
    const refreshSnapshot: MergedRefreshSnapshot = {
      tasks,
      columns,
      defaultViewMode,
      initialColumnNextCursorById,
      initialColumnHiddenCountById,
      initialListNextCursor,
    };

    setBoardState((prev) => {
      const hasArchivedPrevItem = prev.items.some((task) =>
        isTaskArchived(task.id),
      );
      if (
        !hasArchivedPrevItem &&
        prev.lastMergedRefresh !== null &&
        prev.lastMergedRefresh.tasks === tasks &&
        prev.lastMergedRefresh.columns === columns &&
        prev.lastMergedRefresh.defaultViewMode === defaultViewMode &&
        prev.lastMergedRefresh.initialColumnNextCursorById ===
          initialColumnNextCursorById &&
        prev.lastMergedRefresh.initialColumnHiddenCountById ===
          initialColumnHiddenCountById &&
        prev.lastMergedRefresh.initialListNextCursor === initialListNextCursor
      ) {
        return prev;
      }

      const pendingMoves = pendingMovesByContextRef.current.get(prev.context);
      const next = mergeTasksOnServerRefresh({
        prev: prev.items.filter((task) => !isTaskArchived(task.id)),
        serverTasks,
        pendingMoveTaskIds: new Set(pendingMoves?.keys() ?? []),
        // List is a single updatedAt stream: keep load-more rows across
        // router.refresh() and listCursor goes stale vs the new first page.
        // A missing Task on a tagged board may have lost its tag, and under
        // Needs me it may no longer wait for a person. Under Mentions the
        // reader may have answered.
        keepLocalOnlyTasks,
      });

      const archivedLoadedTaskDropped = prev.items.some(
        (task) =>
          isTaskArchived(task.id) && prev.loadedBoardTaskIds.has(task.id),
      );
      const nonArchivedLocalOnlyDropped =
        !keepLocalOnlyTasks &&
        prev.items.some(
          (task) => !isTaskArchived(task.id) && !serverTaskIds.has(task.id),
        );
      const preserveCursorsForArchive =
        !isListView &&
        archivedLoadedTaskDropped &&
        !nonArchivedLocalOnlyDropped;

      // List always resyncs. Board resyncs when no client-only load-more rows
      // remain, except on the archive-driven update that dropped a loaded task.
      if (
        isListView ||
        (!preserveCursorsForArchive && next.length <= serverTasks.length)
      ) {
        return {
          ...prev,
          items: next,
          columnCursorById: buildInitialColumnCursorById(
            columns,
            initialColumnNextCursorById,
          ),
          columnHiddenById: initialColumnHiddenCountById,
          listCursor: initialListNextCursor,
          loadedBoardTaskIds: new Set(),
          lastMergedRefresh: refreshSnapshot,
        };
      }

      const nextIds = new Set(next.map((task) => task.id));
      const remainingLoadedBoardTaskIds = new Set(
        [...prev.loadedBoardTaskIds].filter((id) => nextIds.has(id)),
      );

      return {
        ...prev,
        items: next,
        loadedBoardTaskIds: remainingLoadedBoardTaskIds,
        lastMergedRefresh: refreshSnapshot,
      };
    });
  }, [
    columns,
    defaultViewMode,
    initialColumnHiddenCountById,
    initialColumnNextCursorById,
    initialFilters.mentions,
    initialFilters.needsMe,
    initialFilters.search,
    initialFilters.tag,
    initialListNextCursor,
    tasks,
  ]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const activeId = event.active.id;
    if (typeof activeId !== "string") return;

    const initialRect = event.active.rect.current.initial;
    const translatedRect = event.active.rect.current.translated;
    const currentRect = translatedRect ?? initialRect;

    setActiveDragTaskId(activeId);
    setActiveDragRect(
      currentRect
        ? {
            width: currentRect.width,
            height: currentRect.height,
          }
        : null,
    );
  };

  const handleDragCancel = () => {
    setActiveDragTaskId(null);
    setActiveDragRect(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragTaskId(null);
    setActiveDragRect(null);

    const activeId = event.active.id;
    const overId = event.over?.id;
    if (typeof activeId !== "string" || typeof overId !== "string") return;

    const draggedTask = itemsRef.current.find((task) => task.id === activeId);
    if (!draggedTask || !isTaskDnDDraggable(draggedTask)) {
      return;
    }

    const toColumn = overId as KanbanColumnId;
    if (!isDnDDropColumn(toColumn)) return;

    const fromColumn = event.active.data.current?.columnId as
      | KanbanColumnId
      | undefined;
    if (
      !fromColumn ||
      !isDnDDragColumn(fromColumn) ||
      fromColumn === toColumn
    ) {
      return;
    }

    const desiredStatus = statusForColumn(toColumn);
    if (!desiredStatus) return;

    // Preserve the task's prior status on rollback when a drag update fails.
    const previousStatus = draggedTask.status;
    const previousStatusSince = draggedTask.statusSince;

    const startedContext = requestContext;
    const moveToken = {};
    getContextPendingMoves(
      pendingMovesByContextRef.current,
      startedContext,
    ).set(activeId, moveToken);

    setBoardState((prev) =>
      prev.context !== startedContext
        ? prev
        : {
            ...prev,
            items: prev.items.map((task) =>
              task.id === activeId
                ? {
                    ...task,
                    status: desiredStatus,
                    columnId: toColumn,
                    // The new status starts its clock now.
                    statusSince: new Date().toISOString(),
                  }
                : task,
            ),
          },
    );

    if (
      userTaskStatusTransitionRequiresComment(
        previousStatus,
        desiredStatus,
        draggedTask.assignee != null && draggedTask.assignee.kind !== "user",
      )
    ) {
      setReopenComment("");
      setPendingBoardReopen({
        taskId: activeId,
        assigneeName: draggedTask.assignee?.name ?? "",
        fromColumn,
        toColumn,
        previousStatus,
        previousStatusSince,
        desiredStatus,
        context: startedContext,
        moveToken,
      });
      return;
    }

    const rollbackMove = () => {
      const pendingMoves = pendingMovesByContextRef.current.get(startedContext);
      if (pendingMoves?.get(activeId) !== moveToken) return false;

      pendingMoves.delete(activeId);
      if (currentContextRef.current !== startedContext) return false;

      setBoardState((prev) =>
        prev.context !== startedContext
          ? prev
          : {
              ...prev,
              items: prev.items.map((task) =>
                task.id === activeId &&
                task.columnId === toColumn &&
                task.status === desiredStatus
                  ? {
                      ...task,
                      status: previousStatus,
                      columnId: fromColumn,
                      statusSince: previousStatusSince,
                    }
                  : task,
              ),
            },
      );
      return true;
    };

    void (async () => {
      try {
        const result = await setTaskStatusFromDrag({
          taskId: activeId,
          desiredStatus,
        });
        if (!result.ok) {
          if (rollbackMove()) {
            reportDragRejection(result.error.kind);
          }
          return;
        }
        const pendingMoves =
          pendingMovesByContextRef.current.get(startedContext);
        if (pendingMoves?.get(activeId) === moveToken) {
          pendingMoves.delete(activeId);
        }
      } catch {
        if (rollbackMove()) {
          toast.error(labels.dragError);
        }
      }
    })();
  };

  const rollbackBoardReopen = (pending: PendingBoardReopen) => {
    const pendingMoves = pendingMovesByContextRef.current.get(pending.context);
    if (pendingMoves?.get(pending.taskId) !== pending.moveToken) return false;

    pendingMoves.delete(pending.taskId);
    if (currentContextRef.current !== pending.context) return false;

    setBoardState((prev) =>
      prev.context !== pending.context
        ? prev
        : {
            ...prev,
            items: prev.items.map((task) =>
              task.id === pending.taskId &&
              task.columnId === pending.toColumn &&
              task.status === pending.desiredStatus
                ? {
                    ...task,
                    status: pending.previousStatus,
                    columnId: pending.fromColumn,
                    statusSince: pending.previousStatusSince,
                  }
                : task,
            ),
          },
    );
    return true;
  };

  const handleBoardReopenOpenChange = (open: boolean) => {
    if (open) return;
    if (!shouldRollbackBoardReopenOnDismiss(isReopenPending)) return;
    if (pendingBoardReopen) {
      rollbackBoardReopen(pendingBoardReopen);
    }
    setPendingBoardReopen(null);
    setReopenComment("");
  };

  const handleBoardReopenConfirm = () => {
    if (!pendingBoardReopen) return;

    const trimmedComment = reopenComment.trim();
    if (!trimmedComment) {
      toast.error(labels.reopenToReady.commentRequired);
      return;
    }

    const pending = pendingBoardReopen;
    const clearPendingReopen = () => {
      setPendingBoardReopen((current) =>
        current === pending ? null : current,
      );
      if (currentContextRef.current === pending.context) {
        setReopenComment("");
      }
    };

    startReopenTransition(async () => {
      try {
        const result = await setTaskStatusFromDrag({
          taskId: pending.taskId,
          desiredStatus: pending.desiredStatus,
          comment: trimmedComment,
        });
        if (!result.ok) {
          const rolledBack = rollbackBoardReopen(pending);
          clearPendingReopen();
          if (rolledBack) {
            reportDragRejection(result.error.kind);
          }
          return;
        }
        const pendingMoves = pendingMovesByContextRef.current.get(
          pending.context,
        );
        if (pendingMoves?.get(pending.taskId) === pending.moveToken) {
          pendingMoves.delete(pending.taskId);
        }
        clearPendingReopen();
      } catch {
        const rolledBack = rollbackBoardReopen(pending);
        clearPendingReopen();
        if (rolledBack) {
          toast.error(labels.dragError);
        }
      }
    });
  };

  const handleLoadMoreColumn = useCallback(
    async (columnId: KanbanColumnId) => {
      if (!isTaskPaginationInSync) return;

      const startedContext = requestContext;
      if (currentContextRef.current !== startedContext) return;

      const cursor = columnCursorByIdRef.current[columnId] ?? null;
      const loadingColumns = getContextLoadingColumns(
        loadingColumnIdsByContextRef.current,
        startedContext,
      );
      if (cursor === null || loadingColumns.has(columnId)) return;

      loadingColumns.add(columnId);
      setBoardState((prev) => {
        if (prev.context !== startedContext) return prev;
        const nextLoading = new Set(prev.loadingColumnIds);
        nextLoading.add(columnId);
        return { ...prev, loadingColumnIds: nextLoading };
      });

      try {
        const result = await loadMoreTasksColumn({
          columnId,
          cursor,
          ...routeFilters,
          // Same order as the first page, or the cursor skips Tasks.
          sort: effectiveTasksSort(routeFilters.sort, "board"),
        });
        if (currentContextRef.current !== startedContext) return;
        const nextCursor = result.nextCursor;
        columnCursorByIdRef.current = {
          ...columnCursorByIdRef.current,
          [columnId]: nextCursor,
        };
        setBoardState((prev) => {
          if (prev.context !== startedContext) return prev;
          const existingIds = new Set(prev.items.map((task) => task.id));
          const nextLoadedBoardTaskIds = new Set(prev.loadedBoardTaskIds);
          for (const task of result.tasks) {
            if (!existingIds.has(task.id)) {
              nextLoadedBoardTaskIds.add(task.id);
            }
          }
          return {
            ...prev,
            items: appendUniqueTasks(prev.items, result.tasks),
            columnHiddenById: {
              ...prev.columnHiddenById,
              [columnId]: nextCursor
                ? Math.max(
                    0,
                    (prev.columnHiddenById[columnId] ?? 0) -
                      result.tasks.length,
                  )
                : 0,
            },
            columnCursorById: {
              ...prev.columnCursorById,
              [columnId]: nextCursor,
            },
            loadedBoardTaskIds: nextLoadedBoardTaskIds,
          };
        });
      } catch {
        if (currentContextRef.current !== startedContext) return;
        columnCursorByIdRef.current = {
          ...columnCursorByIdRef.current,
          [columnId]: null,
        };
        setBoardState((prev) =>
          prev.context !== startedContext
            ? prev
            : {
                ...prev,
                columnCursorById: {
                  ...prev.columnCursorById,
                  [columnId]: null,
                },
              },
        );
        toast.error(labels.loadMoreError);
      } finally {
        loadingColumns.delete(columnId);
        if (currentContextRef.current === startedContext) {
          setBoardState((prev) => {
            if (prev.context !== startedContext) return prev;
            const afterLoading = new Set(prev.loadingColumnIds);
            afterLoading.delete(columnId);
            return { ...prev, loadingColumnIds: afterLoading };
          });
        }
      }
    },
    [
      isTaskPaginationInSync,
      labels.loadMoreError,
      requestContext,
      routeFilters,
    ],
  );

  const handleLoadMoreList = useCallback(async () => {
    if (!isTaskPaginationInSync) return;

    const startedContext = requestContext;
    if (currentContextRef.current !== startedContext) return;

    const cursor = listCursorRef.current;
    if (cursor === null || loadingListContextsRef.current.has(startedContext)) {
      return;
    }

    loadingListContextsRef.current.add(startedContext);
    setBoardState((prev) =>
      prev.context !== startedContext
        ? prev
        : { ...prev, isLoadingListMore: true },
    );

    try {
      const result = await loadMoreTasksList({
        cursor,
        ...routeFilters,
      });
      if (currentContextRef.current !== startedContext) return;
      const nextCursor = result.nextCursor;
      listCursorRef.current = nextCursor;
      setBoardState((prev) =>
        prev.context !== startedContext
          ? prev
          : {
              ...prev,
              items: appendUniqueTasks(prev.items, result.tasks),
              listCursor: nextCursor,
            },
      );
    } catch {
      if (currentContextRef.current !== startedContext) return;
      listCursorRef.current = null;
      setBoardState((prev) =>
        prev.context !== startedContext ? prev : { ...prev, listCursor: null },
      );
      toast.error(labels.loadMoreError);
    } finally {
      loadingListContextsRef.current.delete(startedContext);
      if (currentContextRef.current === startedContext) {
        setBoardState((prev) =>
          prev.context !== startedContext
            ? prev
            : { ...prev, isLoadingListMore: false },
        );
      }
    }
  }, [
    isTaskPaginationInSync,
    labels.loadMoreError,
    requestContext,
    routeFilters,
  ]);

  const handleViewModeChange = (next: TasksViewMode) => {
    if (next !== requestContext.viewMode) {
      const nextContext: BoardRequestContext = {
        ...requestContext,
        viewMode: next,
      };
      currentContextRef.current = nextContext;
      setBoardState((prev) =>
        prev.context !== requestContext
          ? prev
          : {
              ...prev,
              context: nextContext,
              loadingColumnIds: new Set(),
              isLoadingListMore: false,
            },
      );
    }
    document.cookie = serializeTasksViewModeCookie(next);
    // A link's `?view=` held only that visit; once chosen here, the saved
    // view decides, so drop it or the refresh would read the old view.
    if (searchParams.has("view")) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("view");
      const nextQuery = params.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
      return;
    }
    router.refresh();
  };

  const handleDensityChange = (next: TasksDensity) => {
    setDensity(next);
    document.cookie = serializeTasksDensityCookie(next);
  };

  const activeDragTask = useMemo(
    () =>
      activeDragTaskId
        ? (items.find((task) => task.id === activeDragTaskId) ?? null)
        : null,
    [activeDragTaskId, items],
  );
  return {
    router,
    pathname,
    searchParams,
    tTasks,
    routeFilters,
    viewMode,
    density,
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
    defaultProjectId,
    isTaskPaginationInSync,
    handleEventUpdate,
    sensors,
    handleDragStart,
    handleDragCancel,
    handleDragEnd,
    handleBoardReopenOpenChange,
    handleBoardReopenConfirm,
    handleLoadMoreColumn,
    handleLoadMoreList,
    handleViewModeChange,
    handleDensityChange,
    activeDragTask,
  };
}
