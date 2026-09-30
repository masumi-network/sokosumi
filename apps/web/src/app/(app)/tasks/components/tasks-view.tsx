"use client";

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { TaskStatus } from "@sokosumi/core-client";
import {
  CORE_API_ERROR_KINDS,
  makeUserTasksChannelName,
  userTaskStatusTransitionRequiresComment,
} from "@sokosumi/utils";
import { ChannelProvider, useChannel } from "ably/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";
import { ListMobileCreateFab } from "@/app/components/list-mobile-create-fab";
import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import { loadMoreTasksColumn, loadMoreTasksList } from "@/app/tasks/actions";
import { TASKS_ROUTE_REFRESH_DEBOUNCE_MS } from "@/app/tasks/constants";
import {
  KANBAN_COLUMNS,
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import { isTaskArchived } from "@/app/tasks/utils/archived-task-ids";
import { mergeTasksOnServerRefresh } from "@/app/tasks/utils/merge-tasks-on-server-refresh";
import {
  getTasksFiltersFromSearchParams,
  getTasksFiltersResetKey,
  type ProjectFilterOption,
  type TasksFilters,
} from "@/app/tasks/utils/tasks-filters";
import {
  applyTasksTabSearchParam,
  parseTasksTab,
  TASKS_TAB_PARAM,
  type TasksTabValue,
} from "@/app/tasks/utils/tasks-tab";
import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import { Button } from "@/components/ui/button";
import {
  SEGMENTED_TAB_TRIGGER_CLASS_NAME,
  SEGMENTED_TABS_LIST_CLASS_NAME,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import { type TaskEventData, taskEventDataSchema } from "@/lib/ably/schema";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";
import type { CoworkerOption } from "@/lib/types/coworker";
import {
  serializeTasksDensityCookie,
  type TasksDensity,
} from "@/lib/ui-preferences/tasks-density";
import {
  serializeTasksViewModeCookie,
  type TasksViewMode,
} from "@/lib/ui-preferences/tasks-view-mode";
import { cn } from "@/lib/utils";
import type { TaskMutationErrorKind } from "@/lib/utils/task-mutation-error-kinds";
import {
  CreateTaskModal,
  CreateTaskModalProvider,
  useCreateTaskModal,
} from "./create-task-modal";
import { KanbanBoard } from "./kanban-board";
import { shouldRollbackBoardReopenOnDismiss } from "./task-board-reopen";
import { TaskCard } from "./task-card";
import {
  isDnDDragColumn,
  isDnDDropColumn,
  isTaskDnDDraggable,
  statusForColumn,
} from "./task-dnd";
import { TaskListItem } from "./task-list-item";
import { TaskListView } from "./task-list-view";
import {
  TaskReopenToReadyDialog,
  type TaskReopenToReadyDialogLabels,
} from "./task-reopen-to-ready-dialog";
import { TasksViewFilters } from "./tasks-view-filters";
import { ViewModeSwitch } from "./view-mode-switch";

interface PendingBoardReopen {
  taskId: string;
  fromColumn: KanbanColumnId;
  toColumn: KanbanColumnId;
  previousStatus: TaskStatus;
  desiredStatus: TaskStatus;
  moveVersion: number;
}

function TasksMobileCreateFabSlot() {
  const { handleOpen } = useCreateTaskModal();
  const t = useTranslations("App.Tasks");

  return (
    <ListMobileCreateFab ariaLabel={t("createTaskFab")} onOpen={handleOpen} />
  );
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

interface TasksRealtimeListenerProps {
  userId: string;
  onEvent: (data: TaskEventData) => void;
}

function TasksRealtimeListener({
  userId,
  onEvent,
}: TasksRealtimeListenerProps) {
  useChannel(makeUserTasksChannelName(userId), (message) => {
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
  });

  return null;
}

interface TasksViewProps {
  tasks: TaskWithCoworker[];
  listNextCursor: string | null;
  columnNextCursorById: Record<KanbanColumnId, string | null>;
  columns?: KanbanColumnDefinition[];
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
  userId?: string | null;
  activeOrganizationId: string | null;
  initialFilters: TasksFilters;
  calendar?: ReactNode;
  defaultViewMode?: TasksViewMode;
  defaultDensity?: TasksDensity;
  initialCreateTaskOpen?: boolean;
  initialAssigneeId?: string | null;
  initialCreateTaskPrompt?: string | null;
  createTaskModalResetKey?: string;
  canCreateTask?: boolean;
  initialTab?: TasksTabValue;
  labels: {
    tabs: {
      tasks: string;
      calendar: string;
    };
    filters: {
      title: string;
      searchPlaceholder: string;
      emptyResults: string;
      all: string;
      scopeLabel: string;
      scopeOwned: string;
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
      list: string;
      board: string;
      density: string;
      normal: string;
      compact: string;
    };
    listPlaceholder: string;
    loadMore: string;
    loading: string;
    dragError: string;
    loadMoreError: string;
    reopenToReady: TaskReopenToReadyDialogLabels & {
      commentRequired: string;
    };
  };
}

export function TasksView({
  tasks,
  listNextCursor: initialListNextCursor,
  columnNextCursorById: initialColumnNextCursorById,
  columns = KANBAN_COLUMNS,
  coworkerOptions,
  projectOptions,
  userId,
  activeOrganizationId,
  initialFilters,
  calendar,
  defaultViewMode,
  defaultDensity,
  initialCreateTaskOpen = false,
  initialAssigneeId = null,
  initialCreateTaskPrompt = null,
  createTaskModalResetKey = "default",
  canCreateTask = false,
  initialTab = "tasks",
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
  const tabFromUrl = parseTasksTab(
    searchParams.get(TASKS_TAB_PARAM) ?? undefined,
  );
  const [activeTab, setActiveTab] = useState<TasksTabValue>(initialTab);
  const [prevTabFromUrl, setPrevTabFromUrl] = useState(tabFromUrl);
  if (tabFromUrl !== prevTabFromUrl) {
    setPrevTabFromUrl(tabFromUrl);
    setActiveTab(tabFromUrl);
  }
  const [items, setItems] = useState<TaskWithCoworker[]>(tasks);
  const [columnCursorById, setColumnCursorById] = useState<
    Record<KanbanColumnId, string | null>
  >(() => buildInitialColumnCursorById(columns, initialColumnNextCursorById));
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
  const columnCursorByIdRef = useRef(columnCursorById);
  columnCursorByIdRef.current = columnCursorById;
  // Every setListCursor / setIsLoadingListMore call writes these refs directly.
  const listCursorRef = useRef(listCursor);
  const isLoadingListMoreRef = useRef(isLoadingListMore);
  const loadingColumnIdsRef = useRef(loadingColumnIds);
  loadingColumnIdsRef.current = loadingColumnIds;
  const refreshRoute = useDebouncedCallback(
    () => router.refresh(),
    TASKS_ROUTE_REFRESH_DEBOUNCE_MS,
  );

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

  useEffect(() => {
    return () => {
      refreshRoute.cancel();
    };
  }, [refreshRoute]);

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

  useEffect(() => {
    const isListView = defaultViewMode === "list";
    const serverTasks = tasks.filter((task) => !isTaskArchived(task.id));
    const next = mergeTasksOnServerRefresh({
      prev: itemsRef.current.filter((task) => !isTaskArchived(task.id)),
      serverTasks,
      pendingMoveTaskIds: new Set(pendingMoveVersionByTaskIdRef.current.keys()),
      // List is a single updatedAt stream: keep load-more rows across
      // router.refresh() and listCursor goes stale vs the new first page.
      keepLocalOnlyTasks: !isListView,
    });

    setItems(next);

    // List always resyncs. Board only when no client-only load-more rows remain.
    if (isListView || next.length <= serverTasks.length) {
      setColumnCursorById(
        buildInitialColumnCursorById(columns, initialColumnNextCursorById),
      );
      setListCursor(initialListNextCursor);
      listCursorRef.current = initialListNextCursor;
      setLoadingColumnIds(new Set());
      setIsLoadingListMore(false);
      isLoadingListMoreRef.current = false;
    }
  }, [
    columns,
    defaultViewMode,
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

    const moveVersion = (moveVersionRef.current += 1);
    pendingMoveVersionByTaskIdRef.current.set(activeId, moveVersion);

    setItems((prev) =>
      prev.map((task) =>
        task.id === activeId
          ? { ...task, status: desiredStatus, columnId: toColumn }
          : task,
      ),
    );

    if (
      userTaskStatusTransitionRequiresComment(previousStatus, desiredStatus)
    ) {
      setReopenComment("");
      setPendingBoardReopen({
        taskId: activeId,
        fromColumn,
        toColumn,
        previousStatus,
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
            ? { ...task, status: previousStatus, columnId: fromColumn }
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
          scope: routeFilters.scope,
          assigneeId: routeFilters.assigneeId,
          assigneeSokoBotId: routeFilters.assigneeSokoBotId,
          assigneeUserId: routeFilters.assigneeUserId,
          status: routeFilters.status,
          projectId: routeFilters.projectId,
          visibility: routeFilters.visibility,
        });
        setItems((prev) => appendUniqueTasks(prev, result.tasks));
        const nextCursor = result.nextCursor;
        setColumnCursorById((prev) => ({
          ...prev,
          [columnId]: nextCursor,
        }));
        columnCursorByIdRef.current = {
          ...columnCursorByIdRef.current,
          [columnId]: nextCursor,
        };
      } catch {
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
        const afterLoading = new Set(loadingColumnIdsRef.current);
        afterLoading.delete(columnId);
        loadingColumnIdsRef.current = afterLoading;
        setLoadingColumnIds(afterLoading);
      }
    },
    [
      isTaskPaginationInSync,
      labels.loadMoreError,
      routeFilters.assigneeId,
      routeFilters.assigneeSokoBotId,
      routeFilters.assigneeUserId,
      routeFilters.projectId,
      routeFilters.scope,
      routeFilters.status,
      routeFilters.visibility,
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
        scope: routeFilters.scope,
        assigneeId: routeFilters.assigneeId,
        assigneeSokoBotId: routeFilters.assigneeSokoBotId,
        assigneeUserId: routeFilters.assigneeUserId,
        status: routeFilters.status,
        projectId: routeFilters.projectId,
        visibility: routeFilters.visibility,
      });
      setItems((prev) => appendUniqueTasks(prev, result.tasks));
      const nextCursor = result.nextCursor;
      setListCursor(nextCursor);
      listCursorRef.current = nextCursor;
    } catch {
      setListCursor(null);
      listCursorRef.current = null;
      toast.error(labels.loadMoreError);
    } finally {
      isLoadingListMoreRef.current = false;
      setIsLoadingListMore(false);
    }
  }, [
    isTaskPaginationInSync,
    labels.loadMoreError,
    routeFilters.assigneeId,
    routeFilters.assigneeSokoBotId,
    routeFilters.assigneeUserId,
    routeFilters.projectId,
    routeFilters.scope,
    routeFilters.status,
    routeFilters.visibility,
  ]);

  const handleViewModeChange = (next: TasksViewMode) => {
    setViewMode(next);
    document.cookie = serializeTasksViewModeCookie(next);
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
            disabled={isLoading || !isTaskPaginationInSync}
          >
            {isLoading ? labels.loading : labels.loadMore}
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
    labels.loading,
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
          disabled={isLoadingListMore || !isTaskPaginationInSync}
        >
          {isLoadingListMore ? labels.loading : labels.loadMore}
        </Button>
      </div>
    );
  }, [
    handleLoadMoreList,
    isLoadingListMore,
    isTaskPaginationInSync,
    labels.loadMore,
    labels.loading,
    listCursor,
  ]);

  const tabsContent = (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        const next = parseTasksTab(value);
        setActiveTab(next);
        const params = applyTasksTabSearchParam(
          new URLSearchParams(window.location.search),
          next,
        );
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname);
      }}
      className={cn(
        "flex h-full min-h-0 flex-1 flex-col gap-5",
        activeTab === "tasks" && LIST_MOBILE_CREATE_FAB_CLEARANCE,
      )}
    >
      <div className="flex flex-row items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <TabsList className={cn(SEGMENTED_TABS_LIST_CLASS_NAME, "w-fit")}>
            <TabsTrigger
              value="tasks"
              className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}
            >
              {labels.tabs.tasks}
            </TabsTrigger>
            <TabsTrigger
              value="calendar"
              className={SEGMENTED_TAB_TRIGGER_CLASS_NAME}
            >
              {labels.tabs.calendar}
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {activeTab === "tasks" ? (
            <TasksViewFilters
              activeOrganizationId={activeOrganizationId}
              coworkerOptions={coworkerOptions}
              projectOptions={projectOptions}
              labels={labels.filters}
            />
          ) : null}
          {activeTab === "tasks" ? (
            <ViewModeSwitch
              value={viewMode}
              onChange={handleViewModeChange}
              density={density}
              onDensityChange={handleDensityChange}
              labels={labels.display}
            />
          ) : null}
        </div>
      </div>

      <TabsContent
        value="tasks"
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-4",
          viewMode === "board" ? "max-h-[calc(100dvh-150px)]" : "max-h-full",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div
            className={cn(
              viewMode === "board" ? "flex min-h-0 min-w-0 flex-1" : "",
            )}
          >
            {isMounted ? (
              <DndContext
                sensors={sensors}
                onDragStart={handleDragStart}
                onDragCancel={handleDragCancel}
                onDragEnd={handleDragEnd}
              >
                {viewMode === "board" ? (
                  <KanbanBoard
                    tasks={items}
                    columns={columns}
                    columnFooterById={columnFooterById}
                    compact={density === "compact"}
                    statusLabels={labels.filters.statusOptions}
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
                    tasks={items}
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
                tasks={items}
                columns={columns}
                columnFooterById={columnFooterById}
                compact={density === "compact"}
                statusLabels={labels.filters.statusOptions}
                labels={{
                  columns: labels.columns,
                  emptyColumn: labels.listPlaceholder,
                }}
                isDragEnabled={false}
              />
            ) : (
              <TaskListView
                tasks={items}
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
      </TabsContent>
      <TabsContent value="calendar" className="flex min-h-0 flex-1 flex-col">
        {calendar}
      </TabsContent>
    </Tabs>
  );

  return (
    <CreateTaskModalProvider
      key={createTaskModalResetKey}
      initialOpen={initialCreateTaskOpen}
      initialAssigneeId={initialAssigneeId}
      initialPrompt={initialCreateTaskPrompt}
      initialProjectId={defaultProjectId}
    >
      {userId ? (
        <LazyAblyProvider>
          <ChannelProvider channelName={makeUserTasksChannelName(userId)}>
            <TasksRealtimeListener
              userId={userId}
              onEvent={handleEventUpdate}
            />
          </ChannelProvider>
        </LazyAblyProvider>
      ) : null}
      {tabsContent}
      {activeTab === "tasks" && canCreateTask ? (
        <TasksMobileCreateFabSlot />
      ) : null}
      <CreateTaskModal
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        defaultProjectId={defaultProjectId}
        initialCreateTaskOpen={initialCreateTaskOpen}
      />
      <TaskReopenToReadyDialog
        open={pendingBoardReopen != null}
        onOpenChange={handleBoardReopenOpenChange}
        labels={labels.reopenToReady}
        comment={reopenComment}
        onCommentChange={setReopenComment}
        onConfirm={handleBoardReopenConfirm}
        isPending={isReopenPending}
      />
    </CreateTaskModalProvider>
  );
}

function appendUniqueTasks(
  prevTasks: TaskWithCoworker[],
  newTasks: TaskWithCoworker[],
) {
  const existingIds = new Set(prevTasks.map((task) => task.id));
  const uniqueNewTasks = newTasks.filter((task) => !existingIds.has(task.id));
  return [...prevTasks, ...uniqueNewTasks];
}

function buildInitialColumnCursorById(
  columns: KanbanColumnDefinition[],
  initialColumnNextCursorById: Record<KanbanColumnId, string | null>,
): Record<KanbanColumnId, string | null> {
  return columns.reduce(
    (acc, column) => {
      acc[column.id] = initialColumnNextCursorById[column.id] ?? null;
      return acc;
    },
    {} as Record<KanbanColumnId, string | null>,
  );
}
