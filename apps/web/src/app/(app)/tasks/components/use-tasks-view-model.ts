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
  type TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import {
  getArchivedTaskIds,
  isTaskArchivePending,
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
  type TasksFilters,
} from "@/app/tasks/utils/tasks-filters";
import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { useLatestRef } from "@/hooks/effects/use-latest-ref";
import { usePendingCreatedTasks } from "@/hooks/effects/use-pending-created-tasks";
import { useRefreshWhenShown } from "@/hooks/effects/use-refresh-when-shown";
import { useTasksBoardAlive } from "@/hooks/effects/use-tasks-board-alive";
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
}

interface TasksBoardDataState {
  snapshot: TaskWithCoworker[];
  items: TaskWithCoworker[];
  columnCursorById: Record<KanbanColumnId, string | null>;
  columnHiddenById: Record<KanbanColumnId, number>;
  loadedBoardColumnByTaskId: ReadonlyMap<string, KanbanColumnId>;
  pendingArchiveIdsByColumn: ReadonlyMap<KanbanColumnId, readonly string[]>;
}

const EMPTY_ARCHIVED_TASK_IDS: ReadonlySet<string> = new Set();

function getServerArchivedTaskIds(): ReadonlySet<string> {
  return EMPTY_ARCHIVED_TASK_IDS;
}

function withoutPendingArchiveColumn(
  prev: ReadonlyMap<KanbanColumnId, readonly string[]>,
  columnId: KanbanColumnId,
): ReadonlyMap<KanbanColumnId, readonly string[]> {
  if (!prev.has(columnId)) {
    return prev;
  }
  const next = new Map(prev);
  next.delete(columnId);
  return next;
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

export function useTasksViewShell({
  coworkerOptions,
  projectOptions,
  activeOrganizationId,
  initialFilters,
  defaultViewMode,
  defaultDensity,
}: Pick<
  TasksViewProps,
  | "coworkerOptions"
  | "projectOptions"
  | "activeOrganizationId"
  | "initialFilters"
  | "defaultViewMode"
  | "defaultDensity"
>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useTasksSearchParams();
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
  const [previousDefaultViewMode, setPreviousDefaultViewMode] =
    useState(defaultViewMode);
  if (previousDefaultViewMode !== defaultViewMode) {
    setPreviousDefaultViewMode(defaultViewMode);
    setViewMode(defaultViewMode ?? "board");
  }
  const [density, setDensity] = useState<TasksDensity>(
    defaultDensity ?? "normal",
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

  const handleEventUpdate = (_data: TaskEventData) => {
    refreshRoute();
  };

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

  return {
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
  };
}

export interface TasksBoardModelProps
  extends Pick<
    TasksViewProps,
    | "tasks"
    | "listNextCursor"
    | "columnNextCursorById"
    | "columnHiddenCountById"
    | "columns"
    | "coworkerOptions"
    | "projectOptions"
    | "initialFilters"
    | "defaultViewMode"
    | "labels"
  > {
  routeFilters: TasksFilters;
  viewMode: TasksViewMode;
  serverTasksFiltersResetKey: string;
  isTaskPaginationInSync: boolean;
}

export function useTasksBoardModel({
  tasks,
  listNextCursor: initialListNextCursor,
  columnNextCursorById: initialColumnNextCursorById,
  columnHiddenCountById: initialColumnHiddenCountById,
  columns = KANBAN_COLUMNS,
  coworkerOptions,
  projectOptions,
  initialFilters,
  defaultViewMode,
  labels,
  routeFilters,
  viewMode,
  serverTasksFiltersResetKey,
  isTaskPaginationInSync,
}: TasksBoardModelProps) {
  const { showCalendarClientUpgradeModal } = useGlobalModalsContext();
  const tTasks = useTranslations("App.Tasks");
  const aliveRef = useTasksBoardAlive();
  /**
   * The board already restored the card by the time this runs. A refused move
   * gets the status error; only a stale client gets the reload modal.
   */
  const reportDragRejection = (kind: TaskMutationErrorKind) => {
    if (!aliveRef.current) return;
    if (kind === CORE_API_ERROR_KINDS.STATUS_NOT_SELECTABLE) {
      toast.error(tTasks("Errors.updateStatus"));
      return;
    }
    showCalendarClientUpgradeModal();
  };
  const [boardData, setBoardData] = useState<TasksBoardDataState>(() => ({
    snapshot: tasks,
    items: tasks,
    columnCursorById: buildInitialColumnCursorById(
      columns,
      initialColumnNextCursorById,
    ),
    columnHiddenById: initialColumnHiddenCountById,
    loadedBoardColumnByTaskId: new Map(),
    pendingArchiveIdsByColumn: new Map(),
  }));
  const { items, columnCursorById, columnHiddenById } = boardData;
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
  const archivedTaskIds = useSyncExternalStore(
    subscribeArchivedTaskIds,
    getArchivedTaskIds,
    getServerArchivedTaskIds,
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
  // Every setListCursor / setIsLoadingListMore call writes these refs directly.
  const listCursorRef = useRef(listCursor);
  const isLoadingListMoreRef = useRef(isLoadingListMore);
  const loadingColumnIdsRef = useRef(loadingColumnIds);
  loadingColumnIdsRef.current = loadingColumnIds;

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
    const serverTasks = tasks.filter((task) => !archivedTaskIds.has(task.id));
    const serverTaskIds = new Set(serverTasks.map((task) => task.id));
    const pendingMoveTaskIds = new Set(
      pendingMoveVersionByTaskIdRef.current.keys(),
    );

    setBoardData((prev) => {
      const isNewSnapshot = prev.snapshot !== tasks;
      const next = mergeTasksOnServerRefresh({
        prev: prev.items.filter((task) => !archivedTaskIds.has(task.id)),
        serverTasks,
        pendingMoveTaskIds,
        // List is a single updatedAt stream: keep load-more rows across
        // router.refresh() and listCursor goes stale vs the new first page.
        // A missing Task on a tagged board may have lost its tag, and under
        // Needs me it may no longer wait for a person. Under Mentions the
        // reader may have answered.
        keepLocalOnlyTasks,
      });

      const nextColumnCursorById = buildInitialColumnCursorById(
        columns,
        initialColumnNextCursorById,
      );

      if (isListView) {
        return {
          snapshot: tasks,
          items: next,
          columnCursorById: nextColumnCursorById,
          columnHiddenById: initialColumnHiddenCountById,
          loadedBoardColumnByTaskId: new Map(),
          pendingArchiveIdsByColumn: new Map(),
        };
      }

      const localOnlyCountByColumn = new Map<KanbanColumnId, number>();
      for (const task of next) {
        if (serverTaskIds.has(task.id)) continue;
        const columnId =
          prev.loadedBoardColumnByTaskId.get(task.id) ?? task.columnId;
        localOnlyCountByColumn.set(
          columnId,
          (localOnlyCountByColumn.get(columnId) ?? 0) + 1,
        );
      }

      // On filtered boards where keepLocalOnlyTasks is false, archive membership
      // cannot tell whether a missing non-archived row still matches the filter
      // or lost its tag, so dropping it requires resyncing that column's cursor
      // instead of stranding the row behind a hidden Load more button.
      const droppedNonArchivedColumns = new Set<KanbanColumnId>();
      if (!keepLocalOnlyTasks) {
        for (const task of prev.items) {
          if (archivedTaskIds.has(task.id) || serverTaskIds.has(task.id))
            continue;
          droppedNonArchivedColumns.add(
            prev.loadedBoardColumnByTaskId.get(task.id) ?? task.columnId,
          );
        }
      }

      // Pin a column's cursor while a loaded row's background DELETE is still
      // pending, or when re-merging the same kept snapshot after settle (e.g.
      // Activity reveal); once a new server snapshot arrives after settle (or
      // the archive fails and unmarks), stop pinning so the fresh server read
      // supplies the current cursor.
      const shouldPinArchivedTask = (id: string) =>
        archivedTaskIds.has(id) && (isTaskArchivePending(id) || !isNewSnapshot);
      const nextPendingArchiveIdsByColumn = new Map<
        KanbanColumnId,
        readonly string[]
      >();
      for (const [columnId, ids] of prev.pendingArchiveIdsByColumn) {
        if (droppedNonArchivedColumns.has(columnId)) continue;
        const stillPendingIds = ids.filter(shouldPinArchivedTask);
        if (stillPendingIds.length > 0) {
          nextPendingArchiveIdsByColumn.set(columnId, stillPendingIds);
        }
      }

      for (const task of prev.items) {
        if (!shouldPinArchivedTask(task.id)) continue;
        const loadedColumn = prev.loadedBoardColumnByTaskId.get(task.id);
        if (!loadedColumn || droppedNonArchivedColumns.has(loadedColumn)) {
          continue;
        }
        const existing = nextPendingArchiveIdsByColumn.get(loadedColumn);
        if (!existing) {
          nextPendingArchiveIdsByColumn.set(loadedColumn, [task.id]);
        } else if (!existing.includes(task.id)) {
          nextPendingArchiveIdsByColumn.set(loadedColumn, [
            ...existing,
            task.id,
          ]);
        }
      }

      const nextColumnHiddenById = { ...initialColumnHiddenCountById };
      for (const column of columns) {
        const columnId = column.id;
        const retainedCount = localOnlyCountByColumn.get(columnId) ?? 0;
        const reportedOverflow = initialColumnHiddenCountById[columnId] ?? 0;
        const preserveForPendingArchive =
          nextPendingArchiveIdsByColumn.has(columnId);
        const preserveForRetainedRows =
          retainedCount > 0 &&
          (prev.columnCursorById[columnId] !== null ||
            retainedCount >= reportedOverflow);
        if (preserveForPendingArchive || preserveForRetainedRows) {
          nextColumnCursorById[columnId] = prev.columnCursorById[columnId];
          nextColumnHiddenById[columnId] = prev.columnHiddenById[columnId];
        } else if (retainedCount > 0) {
          nextColumnHiddenById[columnId] = Math.max(
            0,
            reportedOverflow - retainedCount,
          );
        }
      }

      const remainingLoadedBoardColumnByTaskId = new Map<
        string,
        KanbanColumnId
      >();
      for (const task of next) {
        if (serverTaskIds.has(task.id)) continue;
        const loadedColumn = prev.loadedBoardColumnByTaskId.get(task.id);
        if (loadedColumn) {
          remainingLoadedBoardColumnByTaskId.set(task.id, loadedColumn);
        }
      }

      return {
        snapshot: tasks,
        items: next,
        columnCursorById: nextColumnCursorById,
        columnHiddenById: nextColumnHiddenById,
        loadedBoardColumnByTaskId: remainingLoadedBoardColumnByTaskId,
        pendingArchiveIdsByColumn: nextPendingArchiveIdsByColumn,
      };
    });

    setListCursor(initialListNextCursor);
    listCursorRef.current = initialListNextCursor;
    if (isListView) {
      setLoadingColumnIds(new Set());
      setIsLoadingListMore(false);
      isLoadingListMoreRef.current = false;
    }
  }, [
    archivedTaskIds,
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
    if (!aliveRef.current) return;
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
    if (!aliveRef.current) return;

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

    setBoardData((prev) => ({
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
    }));

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
      setBoardData((prev) => ({
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
      }));
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
        if (aliveRef.current) toast.error(labels.dragError);
      }
    });
  };

  const rollbackBoardReopen = (pending: PendingBoardReopen) => {
    const pendingVersion = pendingMoveVersionByTaskIdRef.current.get(
      pending.taskId,
    );
    if (pendingVersion !== pending.moveVersion) return;

    pendingMoveVersionByTaskIdRef.current.delete(pending.taskId);
    setBoardData((prev) => ({
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
    }));
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
    if (!aliveRef.current || !pendingBoardReopen) return;

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
        if (aliveRef.current) toast.error(labels.dragError);
      }
    });
  };

  // A departure and return to the same filter starts a new stream of pages.
  const pagingContext = useMemo(
    () => ({ filters: serverTasksFiltersResetKey, viewMode }),
    [serverTasksFiltersResetKey, viewMode],
  );
  const pagingContextRef = useLatestRef(pagingContext);

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
          // Same order as the first page, or the cursor skips Tasks.
          sort: effectiveTasksSort(routeFilters.sort, "board"),
        });
        if (pagingContextRef.current !== pagingContext) return;
        const nextCursor = result.nextCursor;
        setBoardData((prev) => {
          const existingIds = new Set(prev.items.map((task) => task.id));
          const appended: TaskWithCoworker[] = [];
          const nextLoadedBoardColumnByTaskId = new Map(
            prev.loadedBoardColumnByTaskId,
          );
          for (const task of result.tasks) {
            if (existingIds.has(task.id)) continue;
            existingIds.add(task.id);
            appended.push(task);
            nextLoadedBoardColumnByTaskId.set(task.id, columnId);
          }
          return {
            ...prev,
            items: appendUniqueTasks(prev.items, appended),
            columnHiddenById: {
              ...prev.columnHiddenById,
              [columnId]: nextCursor
                ? Math.max(
                    0,
                    (prev.columnHiddenById[columnId] ?? 0) - appended.length,
                  )
                : 0,
            },
            columnCursorById: {
              ...prev.columnCursorById,
              [columnId]: nextCursor,
            },
            loadedBoardColumnByTaskId: nextLoadedBoardColumnByTaskId,
            pendingArchiveIdsByColumn: withoutPendingArchiveColumn(
              prev.pendingArchiveIdsByColumn,
              columnId,
            ),
          };
        });
        columnCursorByIdRef.current = {
          ...columnCursorByIdRef.current,
          [columnId]: nextCursor,
        };
      } catch {
        if (pagingContextRef.current !== pagingContext) return;
        setBoardData((prev) => ({
          ...prev,
          columnCursorById: {
            ...prev.columnCursorById,
            [columnId]: null,
          },
          pendingArchiveIdsByColumn: withoutPendingArchiveColumn(
            prev.pendingArchiveIdsByColumn,
            columnId,
          ),
        }));
        columnCursorByIdRef.current = {
          ...columnCursorByIdRef.current,
          [columnId]: null,
        };
        if (aliveRef.current) toast.error(labels.loadMoreError);
      } finally {
        if (pagingContextRef.current === pagingContext) {
          const afterLoading = new Set(loadingColumnIdsRef.current);
          afterLoading.delete(columnId);
          loadingColumnIdsRef.current = afterLoading;
          setLoadingColumnIds(afterLoading);
        }
      }
    },
    [
      aliveRef,
      isTaskPaginationInSync,
      labels.loadMoreError,
      routeFilters,
      pagingContext,
    ],
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
      setBoardData((prev) => ({
        ...prev,
        items: appendUniqueTasks(prev.items, result.tasks),
      }));
      const nextCursor = result.nextCursor;
      setListCursor(nextCursor);
      listCursorRef.current = nextCursor;
    } catch {
      if (pagingContextRef.current !== pagingContext) return;
      setListCursor(null);
      listCursorRef.current = null;
      if (aliveRef.current) toast.error(labels.loadMoreError);
    } finally {
      if (pagingContextRef.current === pagingContext) {
        isLoadingListMoreRef.current = false;
        setIsLoadingListMore(false);
      }
    }
  }, [
    aliveRef,
    isTaskPaginationInSync,
    labels.loadMoreError,
    routeFilters,
    pagingContext,
  ]);

  const activeDragTask = useMemo(
    () =>
      activeDragTaskId
        ? (items.find((task) => task.id === activeDragTaskId) ?? null)
        : null,
    [activeDragTaskId, items],
  );
  return {
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
  };
}
