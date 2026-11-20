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
  type TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import {
  getArchivedTaskIdsVersion,
  getServerArchivedTaskIdsVersion,
  isTaskArchived,
  subscribeArchivedTaskIds,
} from "@/app/tasks/utils/archived-task-ids";
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
import { useRefreshWhenShown } from "@/app/tasks/utils/use-refresh-when-shown";
import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { useLatestRef } from "@/hooks/effects/use-latest-ref";
import { usePendingCreatedTasks } from "@/hooks/effects/use-pending-created-tasks";
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
  resetEpoch: number;
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
  const archivedVersion = useSyncExternalStore(
    subscribeArchivedTaskIds,
    getArchivedTaskIdsVersion,
    getServerArchivedTaskIdsVersion,
  );
  const [items, setItems] = useState<TaskWithCoworker[]>(() =>
    tasks.filter((task) => !isTaskArchived(task.id)),
  );
  const [columnCursorById, setColumnCursorById] = useState<
    Record<KanbanColumnId, string | null>
  >(() => buildInitialColumnCursorById(columns, initialColumnNextCursorById));
  const [columnHiddenById, setColumnHiddenById] = useState(
    initialColumnHiddenCountById,
  );
  const [listCursor, setListCursor] = useState<string | null>(
    initialListNextCursor,
  );
  const [isLoadingListMore, setIsLoadingListMore] = useState(false);
  const [loadingColumnIds, setLoadingColumnIds] = useState<Set<KanbanColumnId>>(
    () => new Set(),
  );
  const [pendingMoveTaskIds, setPendingMoveTaskIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [resetEpoch, setResetEpoch] = useState(0);
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
    new Map<string, { moveVersion: number; resetEpoch: number }>(),
  );
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
  const [prevFiltersKey, setPrevFiltersKey] = useState(
    serverTasksFiltersResetKey,
  );
  const [prevDefaultViewMode, setPrevDefaultViewMode] =
    useState(defaultViewMode);
  const [prevSyncInputs, setPrevSyncInputs] = useState(() => ({
    columns,
    defaultViewMode,
    search: initialFilters.search,
    tag: initialFilters.tag,
    initialColumnNextCursorById,
    initialListNextCursor,
    tasks,
    archivedVersion,
  }));

  const filtersChanged = prevFiltersKey !== serverTasksFiltersResetKey;
  const defaultViewModeChanged = prevDefaultViewMode !== defaultViewMode;
  const syncInputsChanged =
    prevSyncInputs.columns !== columns ||
    prevSyncInputs.defaultViewMode !== defaultViewMode ||
    prevSyncInputs.search !== initialFilters.search ||
    prevSyncInputs.tag !== initialFilters.tag ||
    prevSyncInputs.initialColumnNextCursorById !==
      initialColumnNextCursorById ||
    prevSyncInputs.initialListNextCursor !== initialListNextCursor ||
    prevSyncInputs.tasks !== tasks ||
    prevSyncInputs.archivedVersion !== archivedVersion;

  let currentViewMode = viewMode;
  let currentItems = items;
  let currentColumnCursorById = columnCursorById;
  let currentColumnHiddenById = columnHiddenById;
  let currentListCursor = listCursor;
  let currentLoadingColumnIds = loadingColumnIds;
  let currentIsLoadingListMore = isLoadingListMore;
  let currentPendingMoveTaskIds = pendingMoveTaskIds;
  let currentResetEpoch = resetEpoch;

  if (filtersChanged || defaultViewModeChanged || syncInputsChanged) {
    let shouldResetPagination = false;

    if (filtersChanged || defaultViewModeChanged) {
      if (filtersChanged) {
        setPrevFiltersKey(serverTasksFiltersResetKey);
      }
      if (defaultViewModeChanged) {
        setPrevDefaultViewMode(defaultViewMode);
        currentViewMode = defaultViewMode ?? "board";
        setViewMode(currentViewMode);
      }
      currentResetEpoch = resetEpoch + 1;
      setResetEpoch(currentResetEpoch);
      currentPendingMoveTaskIds = new Set();
      setPendingMoveTaskIds(currentPendingMoveTaskIds);
      currentItems = tasks;
      shouldResetPagination = true;
    }

    setPrevSyncInputs({
      columns,
      defaultViewMode,
      search: initialFilters.search,
      tag: initialFilters.tag,
      initialColumnNextCursorById,
      initialListNextCursor,
      tasks,
      archivedVersion,
    });

    // Adjusted during render before commit: the commit that brings new rows
    // also drops a pending row, and the board must not show a frame without either.
    const isListView = defaultViewMode === "list";
    const serverTasks = tasks.filter((task) => !isTaskArchived(task.id));
    const merged = mergeTasksOnServerRefresh({
      prev: currentItems.filter((task) => !isTaskArchived(task.id)),
      serverTasks,
      pendingMoveTaskIds: currentPendingMoveTaskIds,
      // List is a single updatedAt stream: keep load-more rows across
      // router.refresh() and listCursor goes stale vs the new first page.
      // A missing Task on a tagged board may have lost its tag, and under
      // Needs me it may no longer wait for a person. Under Mentions the
      // reader may have answered.
      keepLocalOnlyTasks:
        !isListView &&
        !initialFilters.search &&
        !initialFilters.tag &&
        !initialFilters.needsMe &&
        !initialFilters.mentions,
    });
    currentItems = merged;
    setItems(merged);

    // List always resyncs. Board only when no client-only load-more rows remain.
    if (
      shouldResetPagination ||
      isListView ||
      merged.length <= serverTasks.length
    ) {
      currentColumnCursorById = buildInitialColumnCursorById(
        columns,
        initialColumnNextCursorById,
      );
      currentColumnHiddenById = initialColumnHiddenCountById;
      currentListCursor = initialListNextCursor;
      currentLoadingColumnIds = new Set();
      currentIsLoadingListMore = false;
      setColumnCursorById(currentColumnCursorById);
      setColumnHiddenById(currentColumnHiddenById);
      setListCursor(currentListCursor);
      setLoadingColumnIds(currentLoadingColumnIds);
      setIsLoadingListMore(currentIsLoadingListMore);
    }
  }

  const itemsRef = useLatestRef(currentItems);
  const resetEpochRef = useLatestRef(currentResetEpoch);
  // Drag, merge and paging keep reading `items`: a pending row is display only.
  const itemsWithPending = usePendingCreatedTasks(
    currentItems,
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
      ? currentItems
      : itemsWithPending;
  const columnCursorByIdRef = useLatestRef(currentColumnCursorById);
  const listCursorRef = useLatestRef(currentListCursor);
  const handleEventUpdate = (_data: TaskEventData) => {
    refreshRoute();
  };

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

    const moveVersion = (moveVersionRef.current += 1);
    const epoch = resetEpochRef.current;
    pendingMoveVersionByTaskIdRef.current.set(activeId, {
      moveVersion,
      resetEpoch: epoch,
    });
    setPendingMoveTaskIds((prev) => {
      const next = new Set(prev);
      next.add(activeId);
      return next;
    });

    const clearPendingMove = (
      taskId: string,
      version: number,
      expectedEpoch: number,
    ) => {
      const entry = pendingMoveVersionByTaskIdRef.current.get(taskId);
      if (
        !entry ||
        entry.moveVersion !== version ||
        entry.resetEpoch !== expectedEpoch ||
        resetEpochRef.current !== expectedEpoch
      ) {
        return false;
      }
      pendingMoveVersionByTaskIdRef.current.delete(taskId);
      setPendingMoveTaskIds((prev) => {
        if (!prev.has(taskId)) return prev;
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
      return true;
    };

    setItems((prev) =>
      prev.map((task) =>
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
        resetEpoch: epoch,
      });
      return;
    }

    const rollbackMove = () => {
      if (!clearPendingMove(activeId, moveVersion, epoch)) return;

      setItems((prev) =>
        prev.map((task) =>
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
      );
    };

    startTransition(async () => {
      try {
        const result = await setTaskStatusFromDrag({
          taskId: activeId,
          desiredStatus,
        });
        if (!result.ok) {
          rollbackMove();
          reportDragRejection(result.error.kind);
          return;
        }
        clearPendingMove(activeId, moveVersion, epoch);
      } catch {
        rollbackMove();
        toast.error(labels.dragError);
      }
    });
  };

  const clearPendingBoardReopenMove = (pending: PendingBoardReopen) => {
    const entry = pendingMoveVersionByTaskIdRef.current.get(pending.taskId);
    if (
      !entry ||
      entry.moveVersion !== pending.moveVersion ||
      entry.resetEpoch !== pending.resetEpoch ||
      resetEpochRef.current !== pending.resetEpoch
    ) {
      return false;
    }
    pendingMoveVersionByTaskIdRef.current.delete(pending.taskId);
    setPendingMoveTaskIds((prev) => {
      if (!prev.has(pending.taskId)) return prev;
      const next = new Set(prev);
      next.delete(pending.taskId);
      return next;
    });
    return true;
  };

  const rollbackBoardReopen = (pending: PendingBoardReopen) => {
    if (!clearPendingBoardReopenMove(pending)) return;

    setItems((prev) =>
      prev.map((task) =>
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
    );
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
          rollbackBoardReopen(pending);
          setPendingBoardReopen(null);
          setReopenComment("");
          reportDragRejection(result.error.kind);
          return;
        }
        clearPendingBoardReopenMove(pending);
        setPendingBoardReopen(null);
        setReopenComment("");
      } catch {
        rollbackBoardReopen(pending);
        setPendingBoardReopen(null);
        setReopenComment("");
        toast.error(labels.dragError);
      }
    });
  };

  // A departure and return to the same filter starts a new stream of pages.
  const pagingContext = useMemo(
    () => ({ filters: serverTasksFiltersResetKey, viewMode: currentViewMode }),
    [serverTasksFiltersResetKey, currentViewMode],
  );
  const pagingContextRef = useLatestRef(pagingContext);
  const inFlightColumnLoadsRef = useRef<{
    context: typeof pagingContext;
    ids: Set<KanbanColumnId>;
  } | null>(null);
  const inFlightListLoadContextRef = useRef<typeof pagingContext | null>(null);

  const handleLoadMoreColumn = useCallback(
    async (columnId: KanbanColumnId) => {
      if (!isTaskPaginationInSync) return;

      const cursor = columnCursorByIdRef.current[columnId] ?? null;
      const inFlightIds =
        inFlightColumnLoadsRef.current?.context === pagingContext
          ? inFlightColumnLoadsRef.current.ids
          : new Set<KanbanColumnId>();
      if (cursor === null || inFlightIds.has(columnId)) return;

      const nextLoading = new Set(inFlightIds);
      nextLoading.add(columnId);
      inFlightColumnLoadsRef.current = {
        context: pagingContext,
        ids: nextLoading,
      };
      setLoadingColumnIds(nextLoading);

      try {
        const result = await loadMoreTasksColumn({
          columnId,
          cursor,
          ...routeFilters,
          // Same order as the first page, or the cursor skips Tasks.
          sort: effectiveTasksSort(routeFilters.sort, "board"),
        });
        if (pagingContextRef.current !== pagingContext) return;
        setItems((prev) => appendUniqueTasks(prev, result.tasks));
        const nextCursor = result.nextCursor;
        setColumnHiddenById((prev) => ({
          ...prev,
          [columnId]: nextCursor
            ? Math.max(0, (prev[columnId] ?? 0) - result.tasks.length)
            : 0,
        }));
        setColumnCursorById((prev) => ({
          ...prev,
          [columnId]: nextCursor,
        }));
        columnCursorByIdRef.current = {
          ...columnCursorByIdRef.current,
          [columnId]: nextCursor,
        };
      } catch {
        if (pagingContextRef.current !== pagingContext) return;
        setColumnCursorById((prev) => ({
          ...prev,
          [columnId]: null,
        }));
        columnCursorByIdRef.current = {
          ...columnCursorByIdRef.current,
          [columnId]: null,
        };
        toast.error(labels.loadMoreError);
      } finally {
        if (pagingContextRef.current === pagingContext) {
          const afterLoading = new Set(
            inFlightColumnLoadsRef.current?.context === pagingContext
              ? inFlightColumnLoadsRef.current.ids
              : [],
          );
          afterLoading.delete(columnId);
          inFlightColumnLoadsRef.current = {
            context: pagingContext,
            ids: afterLoading,
          };
          setLoadingColumnIds(afterLoading);
        }
      }
    },
    [
      columnCursorByIdRef,
      isTaskPaginationInSync,
      labels.loadMoreError,
      pagingContext,
      pagingContextRef,
      routeFilters,
    ],
  );

  const handleLoadMoreList = useCallback(async () => {
    if (!isTaskPaginationInSync) return;

    const cursor = listCursorRef.current;
    if (cursor === null || inFlightListLoadContextRef.current === pagingContext)
      return;

    inFlightListLoadContextRef.current = pagingContext;
    setIsLoadingListMore(true);

    try {
      const result = await loadMoreTasksList({
        cursor,
        ...routeFilters,
      });
      if (pagingContextRef.current !== pagingContext) return;
      setItems((prev) => appendUniqueTasks(prev, result.tasks));
      const nextCursor = result.nextCursor;
      setListCursor(nextCursor);
      listCursorRef.current = nextCursor;
    } catch {
      if (pagingContextRef.current !== pagingContext) return;
      setListCursor(null);
      listCursorRef.current = null;
      toast.error(labels.loadMoreError);
    } finally {
      if (pagingContextRef.current === pagingContext) {
        if (inFlightListLoadContextRef.current === pagingContext) {
          inFlightListLoadContextRef.current = null;
        }
        setIsLoadingListMore(false);
      }
    }
  }, [
    isTaskPaginationInSync,
    labels.loadMoreError,
    listCursorRef,
    pagingContext,
    pagingContextRef,
    routeFilters,
  ]);

  const handleViewModeChange = (next: TasksViewMode) => {
    setViewMode(next);
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
        ? (currentItems.find((task) => task.id === activeDragTaskId) ?? null)
        : null,
    [activeDragTaskId, currentItems],
  );
  return {
    router,
    pathname,
    searchParams,
    tTasks,
    routeFilters,
    viewMode: currentViewMode,
    density,
    shownItems,
    columnCursorById: currentColumnCursorById,
    columnHiddenById: currentColumnHiddenById,
    listCursor: currentListCursor,
    isLoadingListMore: currentIsLoadingListMore,
    loadingColumnIds: currentLoadingColumnIds,
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
