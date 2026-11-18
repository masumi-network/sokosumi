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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  type TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import { isTaskArchived } from "@/app/tasks/utils/archived-task-ids";
import { mergeTasksOnServerRefresh } from "@/app/tasks/utils/merge-tasks-on-server-refresh";
import { buildPendingTask } from "@/app/tasks/utils/pending-created-task";
import {
  appendUniqueTasks,
  buildInitialColumnCursorById,
} from "@/app/tasks/utils/task-pages";
import {
  getTasksFiltersFromSearchParams,
  getTasksFiltersResetKey,
} from "@/app/tasks/utils/tasks-filters";
import { useRefreshWhenShown } from "@/app/tasks/utils/use-refresh-when-shown";
import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
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
import type { TasksViewProps } from "./tasks-view";
import { usePendingCreatedTasks } from "./use-pending-created-tasks";

interface PendingBoardReopen {
  taskId: string;
  assigneeName: string;
  fromColumn: KanbanColumnId;
  toColumn: KanbanColumnId;
  previousStatus: TaskStatus;
  previousStatusSince: string | undefined;
  desiredStatus: TaskStatus;
  moveVersion: number;
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
  const searchParams = useSearchParams();
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
  const [items, setItems] = useState<TaskWithCoworker[]>(tasks);
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
  const pendingMoveVersionByTaskIdRef = useRef(new Map<string, number>());
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
  const shownItems = routeFilters.tag ? items : itemsWithPending;
  const columnCursorByIdRef = useRef(columnCursorById);
  columnCursorByIdRef.current = columnCursorById;
  // Every setListCursor / setIsLoadingListMore call writes these refs directly.
  const listCursorRef = useRef(listCursor);
  const isLoadingListMoreRef = useRef(isLoadingListMore);
  const loadingColumnIdsRef = useRef(loadingColumnIds);
  loadingColumnIdsRef.current = loadingColumnIds;
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
  const previousTasksFiltersResetKeyRef = useRef(serverTasksFiltersResetKey);
  const previousDefaultViewModeRef = useRef(defaultViewMode);
  const handleEventUpdate = (_data: TaskEventData) => {
    refreshRoute();
  };

  useLayoutEffect(() => {
    if (
      previousTasksFiltersResetKeyRef.current === serverTasksFiltersResetKey
    ) {
      return;
    }

    previousTasksFiltersResetKeyRef.current = serverTasksFiltersResetKey;
    moveVersionRef.current = 0;
    pendingMoveVersionByTaskIdRef.current.clear();

    itemsRef.current = tasks;
    setItems(tasks);
    setColumnCursorById(
      buildInitialColumnCursorById(columns, initialColumnNextCursorById),
    );
    setColumnHiddenById(initialColumnHiddenCountById);
    setListCursor(initialListNextCursor);
    listCursorRef.current = initialListNextCursor;
    setLoadingColumnIds(new Set());
    setIsLoadingListMore(false);
    isLoadingListMoreRef.current = false;
  }, [
    columns,
    initialColumnNextCursorById,
    initialListNextCursor,
    serverTasksFiltersResetKey,
    tasks,
  ]);

  useLayoutEffect(() => {
    if (previousDefaultViewModeRef.current === defaultViewMode) {
      return;
    }

    previousDefaultViewModeRef.current = defaultViewMode;
    moveVersionRef.current = 0;
    pendingMoveVersionByTaskIdRef.current.clear();
    setViewMode(defaultViewMode ?? "board");

    itemsRef.current = tasks;
    setItems(tasks);
    setColumnCursorById(
      buildInitialColumnCursorById(columns, initialColumnNextCursorById),
    );
    setColumnHiddenById(initialColumnHiddenCountById);
    setListCursor(initialListNextCursor);
    listCursorRef.current = initialListNextCursor;
    setLoadingColumnIds(new Set());
    setIsLoadingListMore(false);
    isLoadingListMoreRef.current = false;
  }, [
    columns,
    defaultViewMode,
    initialColumnNextCursorById,
    initialListNextCursor,
    tasks,
  ]);

  // Before paint: the commit that brings new rows also drops a pending row,
  // and the board must not show a frame without either.
  useLayoutEffect(() => {
    const isListView = defaultViewMode === "list";
    const serverTasks = tasks.filter((task) => !isTaskArchived(task.id));
    const next = mergeTasksOnServerRefresh({
      prev: itemsRef.current.filter((task) => !isTaskArchived(task.id)),
      serverTasks,
      pendingMoveTaskIds: new Set(pendingMoveVersionByTaskIdRef.current.keys()),
      // List is a single updatedAt stream: keep load-more rows across
      // router.refresh() and listCursor goes stale vs the new first page.
      // A missing Task on a tagged board may have lost its tag.
      keepLocalOnlyTasks: !isListView && !initialFilters.tag,
    });

    setItems(next);

    // List always resyncs. Board only when no client-only load-more rows remain.
    if (isListView || next.length <= serverTasks.length) {
      setColumnCursorById(
        buildInitialColumnCursorById(columns, initialColumnNextCursorById),
      );
      setColumnHiddenById(initialColumnHiddenCountById);
      setListCursor(initialListNextCursor);
      listCursorRef.current = initialListNextCursor;
      setLoadingColumnIds(new Set());
      setIsLoadingListMore(false);
      isLoadingListMoreRef.current = false;
    }
  }, [
    columns,
    defaultViewMode,
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

    const moveVersion = (moveVersionRef.current += 1);
    pendingMoveVersionByTaskIdRef.current.set(activeId, moveVersion);

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
      });
      return;
    }

    const rollbackMove = () => {
      const pendingVersion =
        pendingMoveVersionByTaskIdRef.current.get(activeId);
      if (pendingVersion !== moveVersion) return;

      pendingMoveVersionByTaskIdRef.current.delete(activeId);
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
        if (
          pendingMoveVersionByTaskIdRef.current.get(activeId) === moveVersion
        ) {
          pendingMoveVersionByTaskIdRef.current.delete(activeId);
        }
      } catch {
        rollbackMove();
        toast.error(labels.dragError);
      }
    });
  };

  const rollbackBoardReopen = (pending: PendingBoardReopen) => {
    const pendingVersion = pendingMoveVersionByTaskIdRef.current.get(
      pending.taskId,
    );
    if (pendingVersion !== pending.moveVersion) return;

    pendingMoveVersionByTaskIdRef.current.delete(pending.taskId);
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
        if (
          pendingMoveVersionByTaskIdRef.current.get(pending.taskId) ===
          pending.moveVersion
        ) {
          pendingMoveVersionByTaskIdRef.current.delete(pending.taskId);
        }
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
    () => ({ filters: serverTasksFiltersResetKey, viewMode }),
    [serverTasksFiltersResetKey, viewMode],
  );
  const pagingContextRef = useRef(pagingContext);
  useLayoutEffect(() => {
    pagingContextRef.current = pagingContext;
  }, [pagingContext]);

  const handleLoadMoreColumn = useCallback(
    async (columnId: KanbanColumnId) => {
      if (!isTaskPaginationInSync) return;

      const cursor = columnCursorByIdRef.current[columnId] ?? null;
      if (cursor === null || loadingColumnIdsRef.current.has(columnId)) return;

      const nextLoading = new Set(loadingColumnIdsRef.current);
      nextLoading.add(columnId);
      loadingColumnIdsRef.current = nextLoading;
      setLoadingColumnIds(nextLoading);

      try {
        const result = await loadMoreTasksColumn({
          columnId,
          cursor,
          ...routeFilters,
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
          const afterLoading = new Set(loadingColumnIdsRef.current);
          afterLoading.delete(columnId);
          loadingColumnIdsRef.current = afterLoading;
          setLoadingColumnIds(afterLoading);
        }
      }
    },
    [isTaskPaginationInSync, labels.loadMoreError, routeFilters, pagingContext],
  );

  const handleLoadMoreList = useCallback(async () => {
    if (!isTaskPaginationInSync) return;

    const cursor = listCursorRef.current;
    if (cursor === null || isLoadingListMoreRef.current) return;

    isLoadingListMoreRef.current = true;
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
        isLoadingListMoreRef.current = false;
        setIsLoadingListMore(false);
      }
    }
  }, [
    isTaskPaginationInSync,
    labels.loadMoreError,
    routeFilters,
    pagingContext,
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
