"use client";

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ChannelProvider, useChannel } from "ably/react";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
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
import {
  KANBAN_COLUMNS,
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type TaskWithCoworker,
} from "@/lib/types/task";

import { AddTaskButton } from "./add-task-button";
import { KanbanBoard } from "./kanban-board";
import { isDnDColumn, statusForColumn } from "./task-dnd";
import { TaskListView } from "./task-list-view";
import { ViewModeSwitch } from "./view-mode-switch";

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
  userId?: string | null;
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
    dragError: string;
  };
}

export function TasksView({
  tasks,
  nextCursor: initialNextCursor,
  columns = KANBAN_COLUMNS,
  userId,
  labels,
}: TasksViewProps) {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
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
  const handleEventUpdate = (_data: TaskEventData) => {
    router.refresh();
  };

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

  return (
    <>
      {userId ? (
        <DynamicAblyProvider>
          <ChannelProvider channelName={makeUserTasksChannelName(userId)}>
            <TasksRealtimeListener userId={userId} onEvent={handleEventUpdate} />
          </ChannelProvider>
        </DynamicAblyProvider>
      ) : null}
      <Tabs defaultValue="tasks" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <TabsList>
              <TabsTrigger value="tasks">{labels.tabs.tasks}</TabsTrigger>
              <TabsTrigger value="jobs">{labels.tabs.jobs}</TabsTrigger>
            </TabsList>
            <AddTaskButton label={labels.add} />
          </div>
          <ViewModeSwitch
            value={viewMode}
            onChange={setViewMode}
            labels={labels.display}
          />
        </div>

        <TabsContent value="tasks" className="flex flex-col gap-4">
          {isMounted ? (
            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              {viewMode === "board" ? (
                <KanbanBoard
                  tasks={items}
                  columns={columns}
                  labels={{
                    columns: labels.columns,
                    addTask: labels.addTask,
                  }}
                />
              ) : (
                <TaskListView
                  tasks={items}
                  columns={columns}
                  labels={{
                    columns: labels.columns,
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
              }}
              isDragEnabled={false}
            />
          ) : (
            <TaskListView
              tasks={items}
              columns={columns}
              labels={{
                columns: labels.columns,
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
                {isPending ? "Loading..." : labels.loadMore}
              </Button>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="jobs">
          <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-sm">
            {labels.jobsPlaceholder}
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
