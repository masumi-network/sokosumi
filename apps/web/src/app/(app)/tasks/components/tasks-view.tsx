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
import {
  canUserTransitionTaskStatus,
  makeAgentJobsChannelName,
  makeUserTasksChannelName,
  userTaskStatusTransitionRequiresComment,
} from "@sokosumi/utils";
import { ChannelProvider, useChannel } from "ably/react";
import { CircleHelp, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";
import { ListMobileCreateFab } from "@/app/components/list-mobile-create-fab";
import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import {
  loadJobsTabData,
  loadMoreJobs,
  loadMoreTasksColumn,
  loadMoreTasksList,
} from "@/app/tasks/actions";
import {
  JOBS_TAB_LOAD_RETRY_DELAY_MS,
  TASKS_ROUTE_REFRESH_DEBOUNCE_MS,
} from "@/app/tasks/constants";
import {
  KANBAN_COLUMNS,
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import type { TasksViewJob } from "@/app/tasks/types/tasks-view-job";
import {
  getJobsListFiltersForLazyAgentCatalog,
  getJobsListFiltersResetKey,
  type JobsListFilters,
  mergeTopPageJobsWithListFilters,
} from "@/app/tasks/utils/jobs-filters";
import { mergeTasksOnServerRefresh } from "@/app/tasks/utils/merge-tasks-on-server-refresh";
import {
  getTasksFiltersFromSearchParams,
  getTasksFiltersResetKey,
  isTaskDraggableForViewFilters,
  mergeProjectFilterOptions,
  type ProjectFilterOption,
  type TasksFilters,
} from "@/app/tasks/utils/tasks-filters";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";

import {
  jobStatusDataSchema,
  type TaskEventData,
  taskEventDataSchema,
} from "@/lib/ably";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";
import {
  AgentJobStatus,
  SokosumiJobStatus,
  TaskStatus,
} from "@/lib/clients/generated/core";
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
import {
  CreateTaskModal,
  CreateTaskModalProvider,
  useCreateTaskModal,
} from "./create-task-modal";
import { JobsListView } from "./jobs-list-view";
import { JobsViewFilters } from "./jobs-view-filters";
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
import { shouldShowTasksEmptyStateOverlay } from "./tasks-empty-state";
import { TasksEmptyStateOverlay } from "./tasks-empty-state-overlay";
import { TasksProjectSwitcher } from "./tasks-project-switcher";
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

function HeaderAddButton({ label }: { label: string }) {
  const { handleOpen } = useCreateTaskModal();
  return (
    <Button
      size="sm"
      onClick={handleOpen}
      className="hidden gap-1.5 md:inline-flex"
      data-tasks-add-task-header-anchor
    >
      <Plus className="size-4" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
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

const TASKS_GUIDE_COMPLETED_STORAGE_KEY = "sokosumi.tasks.guideCompleted";
interface TasksRealtimeListenerProps {
  userId: string;
  onEvent: (data: TaskEventData) => void;
}

interface AgentJobsRealtimeListenerProps {
  agentId: string;
  userId: string;
  onStatusUpdate: (data: {
    jobId: string;
    jobStatus: SokosumiJobStatus;
  }) => void;
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

function AgentJobsRealtimeListener({
  agentId,
  userId,
  onStatusUpdate,
}: AgentJobsRealtimeListenerProps) {
  useChannel(makeAgentJobsChannelName(agentId, userId), (message) => {
    const parsedResult = jobStatusDataSchema.safeParse(message.data);
    if (parsedResult.success) {
      onStatusUpdate({
        jobId: parsedResult.data.jobId,
        jobStatus: parsedResult.data.jobStatus,
      });
    } else {
      console.error(
        "Failed to parse JobStatus from message",
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
  initialJobsListFilters: JobsListFilters;
  defaultViewMode?: TasksViewMode;
  defaultDensity?: TasksDensity;
  initialCreateTaskOpen?: boolean;
  initialAssigneeId?: string | null;
  initialCreateTaskPrompt?: string | null;
  createTaskModalResetKey?: string;
  labels: {
    tabs: {
      tasks: string;
      jobs: string;
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
      statusOptions: Record<TaskStatus, string>;
    };
    columns: Record<KanbanColumnId, string>;
    add: string;
    addTask: string;
    jobs: {
      filterButton: string;
      agentLabel: string;
      jobStatusLabel: string;
      jobStatusOptions: Record<AgentJobStatus, string>;
      recentTitle: string;
      emptyRecent: string;
      emptyList: string;
      emptySection: string;
      untitled: string;
      unknownAgent: string;
    };
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
    loadJobsError: string;
    reopenToReady: TaskReopenToReadyDialogLabels & {
      commentRequired: string;
    };
    emptyState: {
      title: string;
      description: string;
      getStartedTitle: string;
      getStartedDescription: string;
      getStartedButton: string;
      next: string;
      back: string;
      addTaskHint: string;
      elenaAvatarAlt: string;
    };
    showGuideAriaLabel: string;
  };
}

type TasksTabValue = "tasks" | "jobs";

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
  initialJobsListFilters,
  defaultViewMode,
  defaultDensity,
  initialCreateTaskOpen = false,
  initialAssigneeId = null,
  initialCreateTaskPrompt = null,
  createTaskModalResetKey = "default",
  labels,
}: TasksViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [createdProjects, setCreatedProjects] = useState<ProjectFilterOption[]>(
    [],
  );
  const resolvedProjectOptions = useMemo(
    () => mergeProjectFilterOptions(projectOptions, createdProjects),
    [createdProjects, projectOptions],
  );
  const routeFilters = useMemo(
    () =>
      getTasksFiltersFromSearchParams(
        searchParams,
        activeOrganizationId,
        coworkerOptions,
        resolvedProjectOptions,
      ),
    [
      activeOrganizationId,
      coworkerOptions,
      resolvedProjectOptions,
      searchParams,
    ],
  );
  const [viewMode, setViewMode] = useState<TasksViewMode>(
    defaultViewMode ?? "board",
  );
  const [density, setDensity] = useState<TasksDensity>(
    defaultDensity ?? "normal",
  );
  const [activeTab, setActiveTab] = useState<TasksTabValue>("tasks");
  const [guideCompleted, setGuideCompleted] = useState<boolean | null>(null);
  const [forceShowGuide, setForceShowGuide] = useState(false);
  const [items, setItems] = useState<TaskWithCoworker[]>(tasks);
  const [jobsItems, setJobsItems] = useState<TasksViewJob[]>([]);
  const [jobsCursor, setJobsCursor] = useState<string | null>(null);
  const [agentPreviews, setAgentPreviews] = useState<
    Record<string, { name: string; icon: string | null }>
  >({});
  const [jobAgentOptions, setJobAgentOptions] = useState<
    Array<{ id: string; name: string; image: string | null }>
  >([]);
  const jobsRouteFilters = useMemo(
    () =>
      getJobsListFiltersForLazyAgentCatalog(
        searchParams,
        activeOrganizationId,
        jobAgentOptions,
        resolvedProjectOptions,
      ),
    [
      activeOrganizationId,
      jobAgentOptions,
      resolvedProjectOptions,
      searchParams,
    ],
  );
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
  const [isJobsPending, startJobsTransition] = useTransition();
  const moveVersionRef = useRef(0);
  const pendingMoveVersionByTaskIdRef = useRef(new Map<string, number>());
  const itemsRef = useRef(items);
  const jobsItemsRef = useRef(jobsItems);
  /** True after at least one successful jobs "Load more"; cleared when jobs reset from the server. */
  const hasAppendedJobsViaPaginationRef = useRef(false);
  /** True after the jobs tab's first server fetch completes. */
  const hasLoadedJobsTabRef = useRef(false);
  const isLoadingJobsTabRef = useRef(false);
  const isRefetchingJobsRef = useRef(false);
  const columnCursorByIdRef = useRef<Record<KanbanColumnId, string | null>>(
    buildInitialColumnCursorById(columns, initialColumnNextCursorById),
  );
  const listCursorRef = useRef<string | null>(initialListNextCursor);
  const isLoadingListMoreRef = useRef(false);
  const loadingColumnIdsRef = useRef<Set<KanbanColumnId>>(new Set());
  const refreshRoute = useDebouncedCallback(
    () => router.refresh(),
    TASKS_ROUTE_REFRESH_DEBOUNCE_MS,
  );

  useEffect(() => {
    try {
      setGuideCompleted(
        window.localStorage.getItem(TASKS_GUIDE_COMPLETED_STORAGE_KEY) ===
          "true",
      );
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const serverTasksFiltersResetKey = useMemo(
    () => getTasksFiltersResetKey(initialFilters, activeOrganizationId),
    [activeOrganizationId, initialFilters],
  );
  const serverJobsListFiltersResetKey = useMemo(
    () =>
      getJobsListFiltersResetKey(initialJobsListFilters, activeOrganizationId),
    [activeOrganizationId, initialJobsListFilters],
  );
  const routeTasksFiltersResetKey = useMemo(
    () => getTasksFiltersResetKey(routeFilters, activeOrganizationId),
    [activeOrganizationId, routeFilters],
  );
  const routeJobsListFiltersResetKey = useMemo(
    () => getJobsListFiltersResetKey(jobsRouteFilters, activeOrganizationId),
    [activeOrganizationId, jobsRouteFilters],
  );
  const selectedProjectId =
    routeFilters.projectId ?? jobsRouteFilters.projectId;
  const defaultProjectId = selectedProjectId;

  const handleProjectCreated = useCallback((project: ProjectFilterOption) => {
    flushSync(() => {
      setCreatedProjects((current) =>
        mergeProjectFilterOptions(current, [project]),
      );
    });
  }, []);
  const isTaskPaginationInSync =
    routeTasksFiltersResetKey === serverTasksFiltersResetKey;
  const isJobsPaginationInSync =
    routeJobsListFiltersResetKey === serverJobsListFiltersResetKey;
  const previousTasksFiltersResetKeyRef = useRef(serverTasksFiltersResetKey);
  const previousJobsListFiltersResetKeyRef = useRef(
    serverJobsListFiltersResetKey,
  );
  const previousDefaultViewModeRef = useRef(defaultViewMode);
  const handleEventUpdate = (_data: TaskEventData) => {
    refreshRoute();
  };

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    jobsItemsRef.current = jobsItems;
  }, [jobsItems]);

  useEffect(() => {
    columnCursorByIdRef.current = columnCursorById;
  }, [columnCursorById]);

  useEffect(() => {
    listCursorRef.current = listCursor;
  }, [listCursor]);

  useEffect(() => {
    isLoadingListMoreRef.current = isLoadingListMore;
  }, [isLoadingListMore]);

  useEffect(() => {
    loadingColumnIdsRef.current = loadingColumnIds;
  }, [loadingColumnIds]);

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
    const next = mergeTasksOnServerRefresh({
      prev: itemsRef.current,
      serverTasks: tasks,
      pendingMoveTaskIds: new Set(pendingMoveVersionByTaskIdRef.current.keys()),
      // List is a single updatedAt stream: keep load-more rows across
      // router.refresh() and listCursor goes stale vs the new first page.
      keepLocalOnlyTasks: !isListView,
    });

    setItems(next);

    // List always resyncs. Board only when no client-only load-more rows remain.
    if (isListView || next.length <= tasks.length) {
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

  const mergeJobsWithExisting = useCallback(
    (fetchedJobs: TasksViewJob[], prevJobs: TasksViewJob[]) => {
      const nextJobIds = new Set(fetchedJobs.map((job) => job.id));
      const merged = [...fetchedJobs];
      prevJobs.forEach((job) => {
        if (!nextJobIds.has(job.id)) {
          merged.push(job);
        }
      });
      return merged;
    },
    [],
  );

  useEffect(() => {
    if (activeTab !== "jobs") return;
    if (hasLoadedJobsTabRef.current) return;

    let cancelled = false;
    let retryTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let hasToastedFailure = false;

    async function fetchJobsTabWithRetry() {
      if (
        cancelled ||
        hasLoadedJobsTabRef.current ||
        isLoadingJobsTabRef.current
      ) {
        return;
      }

      isLoadingJobsTabRef.current = true;
      startJobsTransition(async () => {
        try {
          const result = await loadJobsTabData(
            jobsRouteFilters.scope,
            jobsRouteFilters.agentId,
            jobsRouteFilters.jobStatus,
            jobsRouteFilters.projectId,
          );
          if (cancelled) return;
          hasLoadedJobsTabRef.current = true;
          setJobAgentOptions(result.jobAgentOptions);
          setJobsItems((prev) => mergeJobsWithExisting(result.jobs, prev));
          jobsItemsRef.current = mergeJobsWithExisting(
            result.jobs,
            jobsItemsRef.current,
          );
          setJobsCursor(result.nextCursor);
          setAgentPreviews((prev) => ({
            ...prev,
            ...result.agentPreviewById,
          }));
        } catch {
          if (cancelled) return;
          if (!hasToastedFailure) {
            hasToastedFailure = true;
            toast.error(labels.loadJobsError);
          }
          retryTimeoutId = setTimeout(() => {
            void fetchJobsTabWithRetry();
          }, JOBS_TAB_LOAD_RETRY_DELAY_MS);
        } finally {
          isLoadingJobsTabRef.current = false;
        }
      });
    }

    void fetchJobsTabWithRetry();

    return () => {
      cancelled = true;
      if (retryTimeoutId !== undefined) {
        clearTimeout(retryTimeoutId);
      }
    };
  }, [
    activeTab,
    jobsRouteFilters.agentId,
    jobsRouteFilters.jobStatus,
    jobsRouteFilters.projectId,
    jobsRouteFilters.scope,
    labels.loadJobsError,
    mergeJobsWithExisting,
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
    if (
      !draggedTask ||
      !isTaskDnDDraggable(draggedTask) ||
      !isTaskDraggableForViewFilters(
        draggedTask,
        userId,
        routeFilters,
        initialFilters,
        activeOrganizationId,
      )
    ) {
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
    if (!canUserTransitionTaskStatus(draggedTask.status, desiredStatus)) {
      return;
    }

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

    startTransition(async () => {
      try {
        await setTaskStatusFromDrag({
          taskId: activeId,
          desiredStatus,
        });
        if (
          pendingMoveVersionByTaskIdRef.current.get(activeId) === moveVersion
        ) {
          pendingMoveVersionByTaskIdRef.current.delete(activeId);
        }
      } catch {
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
        await setTaskStatusFromDrag({
          taskId: pending.taskId,
          desiredStatus: pending.desiredStatus,
          comment: trimmedComment,
        });
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
          status: routeFilters.status,
          projectId: routeFilters.projectId,
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
      routeFilters.projectId,
      routeFilters.scope,
      routeFilters.status,
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
        status: routeFilters.status,
        projectId: routeFilters.projectId,
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
    routeFilters.projectId,
    routeFilters.scope,
    routeFilters.status,
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

  const handleLoadMoreJobs = () => {
    if (!isJobsPaginationInSync) return;
    if (!jobsCursor) return;
    startJobsTransition(async () => {
      try {
        const result = await loadMoreJobs(
          jobsCursor,
          jobsRouteFilters.scope,
          jobsRouteFilters.agentId,
          jobsRouteFilters.jobStatus,
          jobsRouteFilters.projectId,
        );
        hasAppendedJobsViaPaginationRef.current = true;
        setJobsItems((prev) => appendUniqueJobs(prev, result.jobs));
        setJobsCursor(result.nextCursor);
        setAgentPreviews((prev) => ({
          ...prev,
          ...result.agentPreviewById,
        }));
      } catch {
        setJobsCursor(null);
      }
    });
  };

  const refetchFirstJobsPage = useCallback(() => {
    if (isRefetchingJobsRef.current) return;
    isRefetchingJobsRef.current = true;

    startJobsTransition(async () => {
      try {
        const result = await loadMoreJobs(
          null,
          jobsRouteFilters.scope,
          jobsRouteFilters.agentId,
          jobsRouteFilters.jobStatus,
          jobsRouteFilters.projectId,
        );
        setJobsItems((prev) =>
          mergeTopPageJobsWithListFilters(prev, result.jobs, jobsRouteFilters),
        );
        setJobsCursor((prevCursor) =>
          hasAppendedJobsViaPaginationRef.current && prevCursor !== null
            ? prevCursor
            : (result.nextCursor ?? null),
        );
        setAgentPreviews((prev) => ({
          ...prev,
          ...result.agentPreviewById,
        }));
      } finally {
        isRefetchingJobsRef.current = false;
      }
    });
  }, [jobsRouteFilters]);

  useLayoutEffect(() => {
    if (
      previousJobsListFiltersResetKeyRef.current ===
      serverJobsListFiltersResetKey
    ) {
      return;
    }

    previousJobsListFiltersResetKeyRef.current = serverJobsListFiltersResetKey;
    isRefetchingJobsRef.current = false;
    hasAppendedJobsViaPaginationRef.current = false;

    if (hasLoadedJobsTabRef.current) {
      refetchFirstJobsPage();
      return;
    }

    jobsItemsRef.current = [];
    setJobsItems([]);
    setJobsCursor(null);
    setAgentPreviews({});
  }, [refetchFirstJobsPage, serverJobsListFiltersResetKey]);

  const handleJobStatusUpdate = ({
    jobId,
    jobStatus,
  }: {
    jobId: string;
    jobStatus: SokosumiJobStatus;
  }) => {
    const existingJob = jobsItemsRef.current.find((job) => job.id === jobId);
    if (!existingJob) {
      refetchFirstJobsPage();
      return;
    }

    if (
      jobStatus === SokosumiJobStatus.COMPLETED &&
      existingJob.completedAt === null
    ) {
      refetchFirstJobsPage();
    }

    const completedAtForUpdate =
      jobStatus === SokosumiJobStatus.COMPLETED &&
      existingJob.completedAt === null
        ? new Date().toISOString()
        : undefined;

    setJobsItems((prev) =>
      prev.map((job) => {
        if (job.id !== jobId || job.status === jobStatus) return job;
        return {
          ...job,
          status: jobStatus,
          ...(completedAtForUpdate !== undefined && {
            completedAt: completedAtForUpdate,
          }),
        };
      }),
    );
  };

  const realtimeAgentIds = useMemo(
    () => Array.from(new Set(jobsItems.map((job) => job.agentId))),
    [jobsItems],
  );
  const shouldShowEmptyStateOverlay =
    shouldShowTasksEmptyStateOverlay({
      activeTab,
      taskCount: items.length,
      viewMode,
      guideCompleted: guideCompleted === true,
    }) || forceShowGuide;
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

  const handleGuideComplete = useCallback(() => {
    setGuideCompleted(true);
    setForceShowGuide(false);
    try {
      window.localStorage.setItem(TASKS_GUIDE_COMPLETED_STORAGE_KEY, "true");
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const handleGuideDismiss = useCallback(() => {
    setForceShowGuide(false);
  }, []);

  const tabsContent = (
    <Tabs
      value={activeTab}
      onValueChange={(value: string) => setActiveTab(value as TasksTabValue)}
      className={cn(
        "flex h-full min-h-0 flex-1 flex-col gap-5",
        activeTab === "tasks" && LIST_MOBILE_CREATE_FAB_CLEARANCE,
      )}
    >
      <div className="flex flex-row items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <TasksProjectSwitcher
            projectOptions={resolvedProjectOptions}
            selectedProjectId={selectedProjectId}
            onProjectCreated={handleProjectCreated}
          />
          <TabsList className="bg-muted/50 flex items-center gap-1 self-start rounded-lg p-1">
            <TabsTrigger
              value="tasks"
              className="text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm"
            >
              {labels.tabs.tasks}
            </TabsTrigger>
            <TabsTrigger
              value="jobs"
              className="text-muted-foreground hover:text-foreground data-[state=active]:bg-background dark:data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors data-[state=active]:shadow-sm"
            >
              {labels.tabs.jobs}
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {activeTab === "tasks" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={labels.showGuideAriaLabel}
              onClick={() => setForceShowGuide(true)}
            >
              <CircleHelp className="size-4" aria-hidden />
            </Button>
          ) : null}
          {activeTab === "tasks" ? (
            <TasksViewFilters
              activeOrganizationId={activeOrganizationId}
              coworkerOptions={coworkerOptions}
              projectOptions={resolvedProjectOptions}
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
          {activeTab === "jobs" ? (
            <JobsViewFilters
              activeOrganizationId={activeOrganizationId}
              agentOptions={jobAgentOptions}
              projectOptions={resolvedProjectOptions}
              filtersLabels={{
                title: labels.filters.title,
                searchPlaceholder: labels.filters.searchPlaceholder,
                emptyResults: labels.filters.emptyResults,
                all: labels.filters.all,
                scopeLabel: labels.filters.scopeLabel,
                scopeOwned: labels.filters.scopeOwned,
                scopeWorkspace: labels.filters.scopeWorkspace,
              }}
              labels={{
                filterButton: labels.jobs.filterButton,
                agentLabel: labels.jobs.agentLabel,
                jobStatusLabel: labels.jobs.jobStatusLabel,
                jobStatusOptions: labels.jobs.jobStatusOptions,
              }}
            />
          ) : null}
          {activeTab === "tasks" ? (
            <HeaderAddButton label={labels.add} />
          ) : null}
        </div>
      </div>

      <TabsContent
        value="tasks"
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-4",
          viewMode === "board" ? "max-h-[calc(100vh-150px)]" : "max-h-full",
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
                      isTaskDnDDraggable(task) &&
                      isTaskDraggableForViewFilters(
                        task,
                        userId,
                        routeFilters,
                        initialFilters,
                        activeOrganizationId,
                      )
                    }
                    labels={{
                      columns: labels.columns,
                      addTask: labels.addTask,
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
                  addTask: labels.addTask,
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
      <TabsContent value="jobs" className="flex flex-col gap-4">
        <JobsListView
          jobs={jobsItems}
          agentPreviewById={agentPreviews}
          columnLabels={labels.columns}
          labels={labels.jobs}
        />
        {jobsCursor ? (
          <div className="flex justify-center">
            <Button
              variant="outline"
              onClick={handleLoadMoreJobs}
              disabled={isJobsPending || !isJobsPaginationInSync}
            >
              {isJobsPending ? labels.loading : labels.loadMore}
            </Button>
          </div>
        ) : null}
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
          {realtimeAgentIds.map((agentId) => (
            <ChannelProvider
              key={agentId}
              channelName={makeAgentJobsChannelName(agentId, userId)}
            >
              <AgentJobsRealtimeListener
                agentId={agentId}
                userId={userId}
                onStatusUpdate={handleJobStatusUpdate}
              />
            </ChannelProvider>
          ))}
        </LazyAblyProvider>
      ) : null}
      {tabsContent}
      {activeTab === "tasks" ? <TasksMobileCreateFabSlot /> : null}
      {shouldShowEmptyStateOverlay ? (
        <TasksEmptyStateOverlay
          labels={labels.emptyState}
          onComplete={handleGuideComplete}
          onDismiss={handleGuideDismiss}
        />
      ) : null}
      <CreateTaskModal
        coworkerOptions={coworkerOptions}
        projectOptions={resolvedProjectOptions}
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

function appendUniqueJobs(prevJobs: TasksViewJob[], newJobs: TasksViewJob[]) {
  const existingIds = new Set(prevJobs.map((job) => job.id));
  const uniqueNewJobs = newJobs.filter((job) => !existingIds.has(job.id));
  return [...prevJobs, ...uniqueNewJobs];
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
