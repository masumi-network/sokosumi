"use client";

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ChannelProvider, useChannel } from "ably/react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { toast } from "sonner";

import { loadMoreTasks } from "@/app/tasks/actions";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DynamicAblyProvider from "@/contexts/alby-provider.dynamic";
import {
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

import {
  CreateTaskModal,
  CreateTaskModalProvider,
  useCreateTaskModal,
} from "./create-task-modal";
import { KanbanBoard } from "./kanban-board";
import { isDnDColumn, statusForColumn } from "./task-dnd";
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
  nextCursor?: string | null;
  columns?: KanbanColumnDefinition[];
  coworkerOptions: CoworkerOption[];
  userId?: string | null;
  defaultViewMode?: TasksViewMode;
  labels: {
    tabs: {
      tasks: string;
      jobs: string;
    };
    columns: Record<KanbanColumnId, string>;
    add: string;
    addTask: string;
    jobsPlaceholder: string;
    display: {
      button: string;
      list: string;
      board: string;
    };
    listPlaceholder: string;
    loadMore: string;
    loading: string;
    dragError: string;
  };
}

type TasksTabValue = "tasks" | "jobs";

export function TasksView({
  tasks,
  nextCursor: initialNextCursor,
  columns = KANBAN_COLUMNS,
  coworkerOptions,
  userId,
  defaultViewMode,
  labels,
}: TasksViewProps) {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<TasksViewMode>(
    defaultViewMode ?? "board",
  );
  const [activeTab, setActiveTab] = useState<TasksTabValue>("tasks");
  const [items, setItems] = useState<TaskWithCoworker[]>(tasks);
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialNextCursor ?? null,
  );
  const isMounted = useSyncExternalStore(
    hydrationStore.subscribe,
    hydrationStore.getSnapshot,
    hydrationStore.getServerSnapshot,
  );
  const [isPending, startTransition] = useTransition();
  const moveVersionRef = useRef(0);
  const pendingMoveVersionByTaskIdRef = useRef(new Map<string, number>());
  const itemsRef = useRef(items);
  const handleEventUpdate = (_data: TaskEventData) => {
    router.refresh();
  };

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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
      setNextCursor(initialNextCursor ?? null);
    }
  }, [initialNextCursor, tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
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

  const handleLoadMore = () => {
    if (!nextCursor) return;
    startTransition(async () => {
      try {
        const result = await loadMoreTasks(nextCursor);
        setItems((prev) => [...prev, ...result.tasks]);
        setNextCursor(result.nextCursor);
      } catch {
        setNextCursor(null);
      }
    });
  };

  const handleViewModeChange = (next: TasksViewMode) => {
    setViewMode(next);
    document.cookie = serializeTasksViewModeCookie(next);
  };

  return (
    <CreateTaskModalProvider>
      {userId ? (
        <DynamicAblyProvider>
          <ChannelProvider channelName={makeUserTasksChannelName(userId)}>
            <TasksRealtimeListener userId={userId} onEvent={handleEventUpdate} />
          </ChannelProvider>
        </DynamicAblyProvider>
      ) : null}
      <Tabs
        value={activeTab}
        onValueChange={(value: string) => setActiveTab(value as TasksTabValue)}
        className="flex flex-col gap-5"
      >
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="">
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
            <ViewModeSwitch
              value={viewMode}
              onChange={handleViewModeChange}
              labels={labels.display}
            />
            {activeTab === "tasks" ? (
              <HeaderAddButton label={labels.add} />
            ) : null}
          </div>
        </div>

        {/* Content */}
        <TabsContent value="tasks" className="flex flex-col gap-4">
          {/* {activeTab === "tasks" ? ( */}
          <div className="flex flex-col gap-4">
            {isMounted ? (
              <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                {viewMode === "board" ? (
                  <KanbanBoard
                    tasks={items}
                    columns={columns}
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
                    labels={{
                      columns: labels.columns,
                      emptyList: labels.listPlaceholder,
                      emptySection: labels.listPlaceholder,
                    }}
                  />
                )}
              </DndContext>
            ) : viewMode === "board" ? (
              <KanbanBoard
                tasks={items}
                columns={columns}
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
                labels={{
                  columns: labels.columns,
                  emptyList: labels.listPlaceholder,
                  emptySection: labels.listPlaceholder,
                }}
                isDragEnabled={false}
              />
            )}
            {nextCursor ? (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  onClick={handleLoadMore}
                  disabled={isPending}
                >
                  {isPending ? labels.loading : labels.loadMore}
                </Button>
              </div>
            ) : null}
          </div>
        </TabsContent>
        {/* ) : ( */}
        <TabsContent value="jobs" className="flex flex-col gap-4">
          <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
            {labels.jobsPlaceholder}
          </div>
        </TabsContent>
        {/* ) : ( */}
      </Tabs>
      <CreateTaskModal coworkerOptions={coworkerOptions} />
    </CreateTaskModalProvider>
  );
}
