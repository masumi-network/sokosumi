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
import { SokosumiJobStatus } from "@sokosumi/database";
import { ChannelProvider, useChannel } from "ably/react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
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
  serializeTasksViewModeCookie,
  type TasksViewMode,
} from "@/lib/ui-preferences/tasks-view-mode";
import { cn } from "@/lib/utils";

import {
  CreateTaskModal,
  CreateTaskModalProvider,
  useCreateTaskModal,
} from "./create-task-modal";
import {
  type JobsFailedFilterMode,
  JobsFilterDropdown,
} from "./jobs-filter-dropdown";
import { JobsListView, type TasksViewJob } from "./jobs-list-view";
import { KanbanBoard } from "./kanban-board";
import { TaskCard } from "./task-card";
import { isDnDColumn, statusForColumn } from "./task-dnd";
import { TaskListItem } from "./task-list-item";
import { TaskListView } from "./task-list-view";
import { ViewModeSwitch } from "./view-mode-switch";

function HeaderAddButton({ label }: { label: string }) {
  const { handleOpen } = useCreateTaskModal();
  return (
    <Button size="sm" onClick={handleOpen} className="gap-1.5">
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

const JOBS_FAILED_FILTER_MODE_STORAGE_KEY =
  "sokosumi.tasks.jobs.failedFilterMode";
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
  agentNameById: Map<string, string>;
  userId?: string | null;
  activeOrganizationId: string | null;
  defaultViewMode?: TasksViewMode;
  labels: {
    tabs: {
      tasks: string;
      jobs: string;
    };
    columns: Record<KanbanColumnId, string>;
    add: string;
    addTask: string;
    jobs: {
      filterButton: string;
      filterHideFailed: string;
      filterShowAll: string;
      recentTitle: string;
      emptyRecent: string;
      emptyList: string;
      emptySection: string;
      untitled: string;
      unknownAgent: string;
      unknownCoworker: string;
    };
    display: {
      button: string;
      list: string;
      board: string;
    };
    listPlaceholder: string;
    loadMore: string;
    loading: string;
    dragError: string;
    loadMoreError: string;
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
  agentNameById,
  userId,
  activeOrganizationId,
  defaultViewMode,
  labels,
}: TasksViewProps) {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<TasksViewMode>(
    defaultViewMode ?? "board",
  );
  const [activeTab, setActiveTab] = useState<TasksTabValue>("tasks");
  const [jobsFailedFilterMode, setJobsFailedFilterMode] =
    useState<JobsFailedFilterMode>(() => {
      if (typeof window === "undefined") {
        return "hideFailed";
      }

      try {
        const storedValue = window.localStorage.getItem(
          JOBS_FAILED_FILTER_MODE_STORAGE_KEY,
        );

        return storedValue === "showAll" ? "showAll" : "hideFailed";
      } catch {
        return "hideFailed";
      }
    });
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
  const isRefetchingJobsRef = useRef(false);
  const columnCursorByIdRef = useRef<Record<KanbanColumnId, string | null>>(
    buildInitialColumnCursorById(columns, initialColumnNextCursorById),
  );
  const loadingColumnIdsRef = useRef<Set<KanbanColumnId>>(new Set());
  const refreshRoute = useDebouncedCallback(
    () => router.refresh(),
    TASKS_ROUTE_REFRESH_DEBOUNCE_MS,
  );
  const scopeKey = activeOrganizationId ?? "personal";
  const previousScopeKeyRef = useRef(scopeKey);
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

  useEffect(() => {
    try {
      window.localStorage.setItem(
        JOBS_FAILED_FILTER_MODE_STORAGE_KEY,
        jobsFailedFilterMode,
      );
    } catch {
      // Ignore storage errors.
    }
  }, [jobsFailedFilterMode]);

  useEffect(() => {
    if (previousScopeKeyRef.current === scopeKey) return;

    previousScopeKeyRef.current = scopeKey;
    moveVersionRef.current = 0;
    pendingMoveVersionByTaskIdRef.current.clear();
    isRefetchingJobsRef.current = false;

    const nextJobCursor = initialJobsNextCursor ?? null;

    itemsRef.current = tasks;
    jobsItemsRef.current = jobs;
    setItems(tasks);
    setJobsItems(jobs);
    setColumnCursorById(
      buildInitialColumnCursorById(columns, initialColumnNextCursorById),
    );
    setLoadingColumnIds(new Set());
    setJobsCursor(nextJobCursor);
    setAgentPreviews(agentPreviewById);
  }, [
    agentPreviewById,
    columns,
    initialColumnNextCursorById,
    initialJobsNextCursor,
    jobs,
    scopeKey,
    tasks,
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

    const toColumn = overId as KanbanColumnId;
    if (!isDnDColumn(toColumn)) return;

    const fromColumn = event.active.data.current?.columnId as
      | KanbanColumnId
      | undefined;
    if (!fromColumn || fromColumn === toColumn) return;

    const desiredStatus = statusForColumn(toColumn);
    if (!desiredStatus) return;

    const previousStatus = statusForColumn(fromColumn);
    if (!previousStatus) return;

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
      const cursor = columnCursorByIdRef.current[columnId] ?? null;
      if (cursor === null || loadingColumnIdsRef.current.has(columnId)) return;

      // Update ref synchronously to block rapid clicks before re-render
      const nextLoading = new Set(loadingColumnIdsRef.current);
      nextLoading.add(columnId);
      loadingColumnIdsRef.current = nextLoading;
      setLoadingColumnIds(nextLoading);

      try {
        const result = await loadMoreTasksColumn({ columnId, cursor });
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
    [labels.loadMoreError],
  );

  const handleViewModeChange = (next: TasksViewMode) => {
    setViewMode(next);
    document.cookie = serializeTasksViewModeCookie(next);
  };

  const handleLoadMoreJobs = () => {
    if (!jobsCursor) return;
    startJobsTransition(async () => {
      try {
        const result = await loadMoreJobs(jobsCursor);
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
        const result = await loadMoreJobs(null);
        setJobsItems((prev) => mergeTopPageJobs(prev, result.jobs));
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
            disabled={isLoading}
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
    labels.loadMore,
    labels.loading,
    loadingColumnIds,
  ]);

  const tabsContent = (
    <Tabs
      value={activeTab}
      onValueChange={(value: string) => setActiveTab(value as TasksTabValue)}
      className="flex h-full min-h-0 flex-1 flex-col gap-5"
    >
      {/* Header */}
      <div className="flex flex-row items-center justify-between gap-3">
        <div className="w-full">
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
            <ViewModeSwitch
              value={viewMode}
              onChange={handleViewModeChange}
              labels={labels.display}
            />
          ) : null}
          {activeTab === "jobs" ? (
            <JobsFilterDropdown
              value={jobsFailedFilterMode}
              onChange={setJobsFailedFilterMode}
              labels={{
                button: labels.jobs.filterButton,
                hideFailed: labels.jobs.filterHideFailed,
                showAll: labels.jobs.filterShowAll,
              }}
            />
          ) : null}
          {activeTab === "tasks" ? (
            <HeaderAddButton label={labels.add} />
          ) : null}
        </div>
      </div>

      {/* Content */}
      <TabsContent
        value="tasks"
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-4",
          viewMode === "board" ? "max-h-[calc(100vh-150px)]" : "max-h-full",
        )}
      >
        {/* {activeTab === "tasks" ? ( */}
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
                        <TaskCard task={activeDragTask} />
                      ) : (
                        <TaskListItem task={activeDragTask} isOverlay />
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
      {/* ) : ( */}
      <TabsContent value="jobs" className="flex flex-col gap-4">
        <JobsListView
          jobs={jobsItems}
          agentPreviewById={agentPreviews}
          columnLabels={labels.columns}
          failedFilterMode={jobsFailedFilterMode}
          labels={labels.jobs}
        />
        {jobsCursor ? (
          <div className="flex justify-center">
            <Button
              variant="outline"
              onClick={handleLoadMoreJobs}
              disabled={isJobsPending}
            >
              {isJobsPending ? labels.loading : labels.loadMore}
            </Button>
          </div>
        ) : null}
      </TabsContent>
      {/* ) : ( */}
    </Tabs>
  );

  return (
    <CreateTaskModalProvider>
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
        </DynamicAblyProvider>
      ) : (
        tabsContent
      )}
      <CreateTaskModal
        coworkerOptions={coworkerOptions}
        agentNameById={agentNameById}
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

function mergeTopPageJobs(
  prevJobs: TasksViewJob[],
  refreshedJobs: TasksViewJob[],
) {
  const refreshedJobIds = new Set(refreshedJobs.map((job) => job.id));
  const remainingJobs = prevJobs.filter((job) => !refreshedJobIds.has(job.id));
  return [...refreshedJobs, ...remainingJobs];
}
