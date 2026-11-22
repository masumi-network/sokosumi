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
  type KanbanColumnId,
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
import { useLatestRef } from "@/hooks/effects/use-latest-ref";
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

interface PendingBoardReopen {
  taskId: string;
  assigneeName: string;
  fromColumn: KanbanColumnId;
  toColumn: KanbanColumnId;
  previousStatus: TaskStatus;
  previousStatusSince: string | undefined;
  desiredStatus: TaskStatus;
  moveVersion: number;
  epoch: number;
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
  const [viewMode, setViewMode] = useState<TasksViewMode>(
    defaultViewMode ?? "board",
  );
  const [density, setDensity] = useState<TasksDensity>(
    defaultDensity ?? "normal",
  );
  const [trackedFilterView, setTrackedFilterView] = useState(() => ({
    filtersKey: getTasksFiltersResetKey(initialFilters, activeOrganizationId),
    defaultViewMode,
  }));
  const [boardState, setBoardState] = useState(() => ({
    epoch: 0,
    items: tasks,
    columnCursorById: buildInitialColumnCursorById(
      columns,
      initialColumnNextCursorById,
    ),
    columnHiddenById: initialColumnHiddenCountById,
    listCursor: initialListNextCursor,
    loadingColumnIds: new Set<KanbanColumnId>(),
    isLoadingListMore: false,
    hasLoadedBoardPages: false,
  }));
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
  const [_isPending, startTransition] = useTransition();
  const moveVersionRef = useRef(0);
  const pendingMoveVersionByTaskIdRef = useRef(
    new Map<string, { epoch: number; version: number }>(),
  );
  const isVisibleRef = useRef(false);
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

  // Reset in render so filter or view changes while hidden under React
  // <Activity> advance the epoch even when layout effects are disconnected.
  const viewModeChanged = trackedFilterView.defaultViewMode !== defaultViewMode;
  if (
    trackedFilterView.filtersKey !== serverTasksFiltersResetKey ||
    viewModeChanged
  ) {
    setTrackedFilterView({
      filtersKey: serverTasksFiltersResetKey,
      defaultViewMode,
    });
    if (viewModeChanged) {
      setViewMode(defaultViewMode ?? "board");
    }
    setBoardState((prev) => ({
      epoch: prev.epoch + 1,
      items: tasks,
      columnCursorById: buildInitialColumnCursorById(
        columns,
        initialColumnNextCursorById,
      ),
      columnHiddenById: initialColumnHiddenCountById,
      listCursor: initialListNextCursor,
      loadingColumnIds: new Set(),
      isLoadingListMore: false,
      hasLoadedBoardPages: false,
    }));
  }

  const {
    epoch: boardEpoch,
    items,
    columnCursorById,
    columnHiddenById,
    listCursor,
    loadingColumnIds,
    isLoadingListMore,
  } = boardState;

  const itemsRef = useRef(items);
  itemsRef.current = items;
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
  const columnCursorByIdRef = useRef(columnCursorById);
  columnCursorByIdRef.current = columnCursorById;
  const listCursorRef = useRef(listCursor);
  listCursorRef.current = listCursor;
  const isLoadingListMoreRef = useRef(isLoadingListMore);
  isLoadingListMoreRef.current = isLoadingListMore;
  const loadingColumnIdsRef = useRef(loadingColumnIds);
  loadingColumnIdsRef.current = loadingColumnIds;
  const boardEpochRef = useLatestRef(boardEpoch);

  const handleEventUpdate = (_data: TaskEventData) => {
    refreshRoute();
  };

  // Before paint: the commit that brings new rows also drops a pending row,
  // and the board must not show a frame without either.
  useLayoutEffect(() => {
    isVisibleRef.current = true;
    const isListView = defaultViewMode === "list";
    const keepLocalOnlyTasks =
      !isListView &&
      !initialFilters.search &&
      !initialFilters.tag &&
      !initialFilters.needsMe &&
      !initialFilters.mentions;
    const serverTasks = tasks.filter((task) => !isTaskArchived(task.id));

    setBoardState((prev) => {
      const pendingMoveTaskIds = new Set<string>();
      for (const [taskId, pending] of pendingMoveVersionByTaskIdRef.current) {
        if (pending.epoch === prev.epoch) {
          pendingMoveTaskIds.add(taskId);
        }
      }

      const next = mergeTasksOnServerRefresh({
        prev: prev.items.filter((task) => !isTaskArchived(task.id)),
        serverTasks,
        pendingMoveTaskIds,
        // List is a single updatedAt stream: keep load-more rows across
        // router.refresh() and listCursor goes stale vs the new first page.
        // A missing Task on a tagged board may have lost its tag, and under
        // Needs me it may no longer wait for a person. Under Mentions the
        // reader may have answered.
        keepLocalOnlyTasks,
      });

      // List always resyncs. Board only when no client-only load-more rows
      // remain and no load-more pages have been fetched for this epoch.
      if (
        isListView ||
        !keepLocalOnlyTasks ||
        (!prev.hasLoadedBoardPages && next.length <= serverTasks.length)
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
          loadingColumnIds: new Set(),
          isLoadingListMore: false,
          hasLoadedBoardPages: false,
        };
      }

      return {
        ...prev,
        items: next,
      };
    });

    return () => {
      isVisibleRef.current = false;
    };
  }, [
    columns,
    defaultViewMode,
    initialColumnHiddenCountById,
    initialFilters.mentions,
    initialFilters.needsMe,
    initialFilters.search,
    initialFilters.tag,
    initialColumnNextCursorById,
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

    const startedEpoch = boardEpoch;
    const moveVersion = (moveVersionRef.current += 1);
    pendingMoveVersionByTaskIdRef.current.set(activeId, {
      epoch: startedEpoch,
      version: moveVersion,
    });

    setBoardState((prev) =>
      prev.epoch !== startedEpoch
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
        moveVersion,
        epoch: startedEpoch,
      });
      return;
    }

    const rollbackMove = () => {
      const pending = pendingMoveVersionByTaskIdRef.current.get(activeId);
      if (
        !pending ||
        pending.epoch !== startedEpoch ||
        pending.version !== moveVersion
      ) {
        return false;
      }

      pendingMoveVersionByTaskIdRef.current.delete(activeId);
      setBoardState((prev) =>
        prev.epoch !== startedEpoch
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

    startTransition(async () => {
      try {
        const result = await setTaskStatusFromDrag({
          taskId: activeId,
          desiredStatus,
        });
        if (!result.ok) {
          const rolledBack = rollbackMove();
          if (
            rolledBack &&
            isVisibleRef.current &&
            boardEpochRef.current === startedEpoch
          ) {
            reportDragRejection(result.error.kind);
          }
          return;
        }
        const pending = pendingMoveVersionByTaskIdRef.current.get(activeId);
        if (
          pending?.epoch === startedEpoch &&
          pending.version === moveVersion
        ) {
          pendingMoveVersionByTaskIdRef.current.delete(activeId);
        }
      } catch {
        const rolledBack = rollbackMove();
        if (
          rolledBack &&
          isVisibleRef.current &&
          boardEpochRef.current === startedEpoch
        ) {
          toast.error(labels.dragError);
        }
      }
    });
  };

  const rollbackBoardReopen = (pending: PendingBoardReopen) => {
    const currentPending = pendingMoveVersionByTaskIdRef.current.get(
      pending.taskId,
    );
    if (
      !currentPending ||
      currentPending.epoch !== pending.epoch ||
      currentPending.version !== pending.moveVersion
    ) {
      return false;
    }

    pendingMoveVersionByTaskIdRef.current.delete(pending.taskId);
    setBoardState((prev) =>
      prev.epoch !== pending.epoch
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
    startReopenTransition(async () => {
      try {
        const result = await setTaskStatusFromDrag({
          taskId: pending.taskId,
          desiredStatus: pending.desiredStatus,
          comment: trimmedComment,
        });
        if (!result.ok) {
          const rolledBack = rollbackBoardReopen(pending);
          setPendingBoardReopen(null);
          setReopenComment("");
          if (
            rolledBack &&
            isVisibleRef.current &&
            boardEpochRef.current === pending.epoch
          ) {
            reportDragRejection(result.error.kind);
          }
          return;
        }
        const currentPending = pendingMoveVersionByTaskIdRef.current.get(
          pending.taskId,
        );
        if (
          currentPending?.epoch === pending.epoch &&
          currentPending.version === pending.moveVersion
        ) {
          pendingMoveVersionByTaskIdRef.current.delete(pending.taskId);
        }
        setPendingBoardReopen(null);
        setReopenComment("");
      } catch {
        const rolledBack = rollbackBoardReopen(pending);
        setPendingBoardReopen(null);
        setReopenComment("");
        if (
          rolledBack &&
          isVisibleRef.current &&
          boardEpochRef.current === pending.epoch
        ) {
          toast.error(labels.dragError);
        }
      }
    });
  };

  const handleLoadMoreColumn = useCallback(
    async (columnId: KanbanColumnId) => {
      if (!isTaskPaginationInSync) return;

      const cursor = columnCursorByIdRef.current[columnId] ?? null;
      if (cursor === null || loadingColumnIdsRef.current.has(columnId)) return;

      const startedEpoch = boardEpoch;
      const nextLoading = new Set(loadingColumnIdsRef.current);
      nextLoading.add(columnId);
      loadingColumnIdsRef.current = nextLoading;
      setBoardState((prev) =>
        prev.epoch !== startedEpoch
          ? prev
          : { ...prev, loadingColumnIds: nextLoading },
      );

      try {
        const result = await loadMoreTasksColumn({
          columnId,
          cursor,
          ...routeFilters,
          // Same order as the first page, or the cursor skips Tasks.
          sort: effectiveTasksSort(routeFilters.sort, "board"),
        });
        const nextCursor = result.nextCursor;
        setBoardState((prev) => {
          if (prev.epoch !== startedEpoch) return prev;
          const afterLoading = new Set(prev.loadingColumnIds);
          afterLoading.delete(columnId);
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
            loadingColumnIds: afterLoading,
            hasLoadedBoardPages: true,
          };
        });
      } catch {
        setBoardState((prev) => {
          if (prev.epoch !== startedEpoch) return prev;
          const afterLoading = new Set(prev.loadingColumnIds);
          afterLoading.delete(columnId);
          return {
            ...prev,
            columnCursorById: {
              ...prev.columnCursorById,
              [columnId]: null,
            },
            loadingColumnIds: afterLoading,
          };
        });
        if (isVisibleRef.current && boardEpochRef.current === startedEpoch) {
          toast.error(labels.loadMoreError);
        }
      }
    },
    [
      boardEpoch,
      boardEpochRef,
      isTaskPaginationInSync,
      labels.loadMoreError,
      routeFilters,
    ],
  );

  const handleLoadMoreList = useCallback(async () => {
    if (!isTaskPaginationInSync) return;

    const cursor = listCursorRef.current;
    if (cursor === null || isLoadingListMoreRef.current) return;

    const startedEpoch = boardEpoch;
    isLoadingListMoreRef.current = true;
    setBoardState((prev) =>
      prev.epoch !== startedEpoch ? prev : { ...prev, isLoadingListMore: true },
    );

    try {
      const result = await loadMoreTasksList({
        cursor,
        ...routeFilters,
      });
      const nextCursor = result.nextCursor;
      setBoardState((prev) =>
        prev.epoch !== startedEpoch
          ? prev
          : {
              ...prev,
              items: appendUniqueTasks(prev.items, result.tasks),
              listCursor: nextCursor,
              isLoadingListMore: false,
            },
      );
    } catch {
      setBoardState((prev) =>
        prev.epoch !== startedEpoch
          ? prev
          : {
              ...prev,
              listCursor: null,
              isLoadingListMore: false,
            },
      );
      if (isVisibleRef.current && boardEpochRef.current === startedEpoch) {
        toast.error(labels.loadMoreError);
      }
    }
  }, [
    boardEpoch,
    boardEpochRef,
    isTaskPaginationInSync,
    labels.loadMoreError,
    routeFilters,
  ]);

  const handleViewModeChange = (next: TasksViewMode) => {
    setViewMode(next);
    setBoardState((prev) => ({ ...prev, epoch: prev.epoch + 1 }));
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
