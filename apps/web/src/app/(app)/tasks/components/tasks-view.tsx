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
  AgentJobStatus,
  canUserTransitionTaskStatus,
  SokosumiJobStatus,
  TaskStatus,
} from "@sokosumi/utils";
import { ChannelProvider, useChannel } from "ably/react";
import { CircleHelp, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";

import { loadMoreJobs, loadMoreTasksColumn } from "@/app/tasks/actions";
import { TASKS_ROUTE_REFRESH_DEBOUNCE_MS } from "@/app/tasks/constants";
import type { TasksViewJob } from "@/app/tasks/types/tasks-view-job";
import {
  getJobsListFiltersFromSearchParams,
  getJobsListFiltersResetKey,
  type JobsListFilters,
  mergeTopPageJobsWithListFilters,
} from "@/app/tasks/utils/jobs-filters";
import {
  getTasksFiltersFromSearchParams,
  getTasksFiltersResetKey,
  isTaskDraggableForViewFilters,
  type ProjectFilterOption,
  type TasksFilters,
} from "@/app/tasks/utils/tasks-filters";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DynamicAblyProvider from "@/contexts/alby-provider.dynamic";
import {
  jobStatusDataSchema,
  makeAgentJobsChannelName,
  makeUserTasksChannelName,
  type TaskEventData,
  taskEventDataSchema,
} from "@/lib/ably";
import { setTaskStatusFromDrag } from "@/lib/actions/task/action";
import type { CoworkerOption } from "@/lib/types/coworker";
import {
  KANBAN_COLUMNS,
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type TaskWithCoworker,
} from "@/lib/types/task";
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
import { TaskCard } from "./task-card";
import { isDnDDragColumn, isDnDDropColumn, statusForColumn } from "./task-dnd";
import type { TaskFormInitialDesignMdAttachment } from "./task-form";
import { TaskListItem } from "./task-list-item";
import { TaskListView } from "./task-list-view";
import { shouldShowTasksEmptyStateOverlay } from "./tasks-empty-state";
import { TasksEmptyStateOverlay } from "./tasks-empty-state-overlay";
import { TasksViewFilters } from "./tasks-view-filters";
import { ViewModeSwitch } from "./view-mode-switch";

function HeaderAddButton({ label }: { label: string }) {
  const { handleOpen } = useCreateTaskModal();
  return (
    <Button
      size="sm"
      onClick={handleOpen}
      className="gap-1.5"
      data-tasks-add-task-header-anchor
    >
      <Plus className="size-4" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </Button>
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
  jobs: TasksViewJob[];
  jobsNextCursor?: string | null;
  agentPreviewById: Record<string, { name: string; icon: string | null }>;
  columnNextCursorById: Record<KanbanColumnId, string | null>;
  columns?: KanbanColumnDefinition[];
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
  jobAgentOptions: Array<{ id: string; name: string; image: string | null }>;
  agentNameById: Map<string, string>;
  userId?: string | null;
  activeOrganizationId: string | null;
  initialFilters: TasksFilters;
  initialJobsListFilters: JobsListFilters;
  defaultViewMode?: TasksViewMode;
  defaultDensity?: TasksDensity;
  initialCreateTaskOpen?: boolean;
  initialCoworkerId?: string | null;
  initialCreateTaskPrompt?: string | null;
  initialDesignMdAttachment?: TaskFormInitialDesignMdAttachment | null;
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
      projectLabel: string;
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
    emptyState: {
      title: string;
      description: string;
      chatTitle: string;
      chatDescription: string;
      getStartedTitle: string;
      getStartedDescription: string;
      getStartedButton: string;
      next: string;
      back: string;
      addTaskHint: string;
      chatHint: string;
      elenaAvatarAlt: string;
    };
    showGuideAriaLabel: string;
  };
}

type TasksTabValue = "tasks" | "jobs";

export function TasksView({
  tasks,
  jobs,
  jobsNextCursor: initialJobsNextCursor,
  agentPreviewById,
  columnNextCursorById: initialColumnNextCursorById,
  columns = KANBAN_COLUMNS,
  coworkerOptions,
  projectOptions,
  jobAgentOptions,
  agentNameById,
  userId,
  activeOrganizationId,
  initialFilters,
  initialJobsListFilters,
  defaultViewMode,
  defaultDensity,
  initialCreateTaskOpen = false,
  initialCoworkerId = null,
  initialCreateTaskPrompt = null,
  initialDesignMdAttachment = null,
  createTaskModalResetKey = "default",
  labels,
}: TasksViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const jobsRouteFilters = useMemo(
    () =>
      getJobsListFiltersFromSearchParams(
        searchParams,
        activeOrganizationId,
        jobAgentOptions,
        projectOptions,
      ),
    [activeOrganizationId, jobAgentOptions, projectOptions, searchParams],
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
  const [jobsItems, setJobsItems] = useState<TasksViewJob[]>(jobs);
  const [jobsCursor, setJobsCursor] = useState<string | null>(
    initialJobsNextCursor ?? null,
  );
  const [agentPreviews, setAgentPreviews] = useState(agentPreviewById);
  const [columnCursorById, setColumnCursorById] = useState<
    Record<KanbanColumnId, string | null>
  >(() => buildInitialColumnCursorById(columns, initialColumnNextCursorById));
  const [loadingColumnIds, setLoadingColumnIds] = useState<Set<KanbanColumnId>>(
    () => new Set(),
  );
  const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null);
  const [activeDragRect, setActiveDragRect] = useState<{
    width: number;
    height: number;
  } | null>(null);
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
  const isRefetchingJobsRef = useRef(false);
  const columnCursorByIdRef = useRef<Record<KanbanColumnId, string | null>>(
    buildInitialColumnCursorById(columns, initialColumnNextCursorById),
  );
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
  const projectNameById = useMemo(
    () => new Map(projectOptions.map((project) => [project.id, project.name])),
    [projectOptions],
  );
  const selectedProjectId =
    routeFilters.projectId ?? jobsRouteFilters.projectId;
  const defaultProjectId = selectedProjectId;
  const selectedProjectName = selectedProjectId
    ? (projectNameById.get(selectedProjectId) ?? null)
    : null;
  const isTaskPaginationInSync =
    routeTasksFiltersResetKey === serverTasksFiltersResetKey;
  const isJobsPaginationInSync =
    routeJobsListFiltersResetKey === serverJobsListFiltersResetKey;
  const previousTasksFiltersResetKeyRef = useRef(serverTasksFiltersResetKey);
  const previousJobsListFiltersResetKeyRef = useRef(
    serverJobsListFiltersResetKey,
  );
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
    setLoadingColumnIds(new Set());
  }, [columns, initialColumnNextCursorById, serverTasksFiltersResetKey, tasks]);

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

    const nextJobCursor = initialJobsNextCursor ?? null;

    jobsItemsRef.current = jobs;
    setJobsItems(jobs);
    setJobsCursor(nextJobCursor);
    setAgentPreviews(agentPreviewById);
  }, [
    agentPreviewById,
    initialJobsNextCursor,
    jobs,
    serverJobsListFiltersResetKey,
  ]);

  useEffect(() => {
    const prev = itemsRef.current;
    const prevById = new Map(prev.map((task) => [task.id, task]));
    const next = tasks.map((task) => {
      if (pendingMoveVersionByTaskIdRef.current.has(task.id)) {
        const localTask = prevById.get(task.id);
        if (localTask) return localTask;
      }
      return task;
    });

    const nextIds = new Set(tasks.map((task) => task.id));
    prev.forEach((task) => {
      if (!nextIds.has(task.id)) {
        next.push(task);
      }
    });

    setItems(next);

    if (next.length <= tasks.length) {
      setColumnCursorById(
        buildInitialColumnCursorById(columns, initialColumnNextCursorById),
      );
      setLoadingColumnIds(new Set());
    }
  }, [columns, initialColumnNextCursorById, tasks]);

  useEffect(() => {
    const prev = jobsItemsRef.current;
    const nextJobIds = new Set(jobs.map((job) => job.id));
    const next = [...jobs];

    prev.forEach((job) => {
      if (!nextJobIds.has(job.id)) {
        next.push(job);
      }
    });

    setJobsItems(next);

    if (next.length <= jobs.length) {
      hasAppendedJobsViaPaginationRef.current = false;
      setJobsCursor(initialJobsNextCursor ?? null);
    }
  }, [initialJobsNextCursor, jobs]);

  useEffect(() => {
    setAgentPreviews((prev) => ({
      ...prev,
      ...agentPreviewById,
    }));
  }, [agentPreviewById]);

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
          coworkerId: routeFilters.coworkerId,
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
      routeFilters.coworkerId,
      routeFilters.projectId,
      routeFilters.scope,
      routeFilters.status,
    ],
  );

  const handleViewModeChange = (next: TasksViewMode) => {
    setViewMode(next);
    document.cookie = serializeTasksViewModeCookie(next);
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

  const refetchFirstJobsPage = () => {
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
  };

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
      className="flex h-full min-h-0 flex-1 flex-col gap-5"
    >
      <div className="flex flex-row items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
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
          {selectedProjectName ? (
            <p className="text-muted-foreground truncate text-sm font-medium">
              {selectedProjectName}
            </p>
          ) : null}
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
          {activeTab === "jobs" ? (
            <JobsViewFilters
              activeOrganizationId={activeOrganizationId}
              agentOptions={jobAgentOptions}
              projectOptions={projectOptions}
              filtersLabels={{
                title: labels.filters.title,
                searchPlaceholder: labels.filters.searchPlaceholder,
                emptyResults: labels.filters.emptyResults,
                all: labels.filters.all,
                scopeLabel: labels.filters.scopeLabel,
                scopeOwned: labels.filters.scopeOwned,
                scopeWorkspace: labels.filters.scopeWorkspace,
                projectLabel: labels.filters.projectLabel,
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
              viewMode === "board" ? "flex min-h-0 flex-1 overflow-hidden" : "",
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
                    columns={columns}
                    sectionFooterById={columnFooterById}
                    compact={density === "compact"}
                    statusLabels={labels.filters.statusOptions}
                    canDragTask={(task) =>
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
                      emptyList: labels.listPlaceholder,
                      emptySection: labels.listPlaceholder,
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
                columns={columns}
                sectionFooterById={columnFooterById}
                compact={density === "compact"}
                statusLabels={labels.filters.statusOptions}
                labels={{
                  columns: labels.columns,
                  emptyList: labels.listPlaceholder,
                  emptySection: labels.listPlaceholder,
                }}
                isDragEnabled={false}
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
      initialCoworkerId={initialCoworkerId}
      initialPrompt={initialCreateTaskPrompt}
      initialProjectId={defaultProjectId}
    >
      {userId ? (
        <DynamicAblyProvider>
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
          {tabsContent}
          {shouldShowEmptyStateOverlay ? (
            <TasksEmptyStateOverlay
              labels={labels.emptyState}
              onComplete={handleGuideComplete}
              onDismiss={handleGuideDismiss}
            />
          ) : null}
        </DynamicAblyProvider>
      ) : (
        <>
          {tabsContent}
          {shouldShowEmptyStateOverlay ? (
            <TasksEmptyStateOverlay
              labels={labels.emptyState}
              onComplete={handleGuideComplete}
              onDismiss={handleGuideDismiss}
            />
          ) : null}
        </>
      )}
      <CreateTaskModal
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        defaultProjectId={defaultProjectId}
        agentNameById={agentNameById}
        initialDesignMdAttachment={initialDesignMdAttachment}
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
