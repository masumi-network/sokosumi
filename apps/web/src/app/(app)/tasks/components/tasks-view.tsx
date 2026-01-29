"use client";

import { useState, useTransition } from "react";

import { loadMoreTasks } from "@/app/tasks/actions";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  KANBAN_COLUMNS,
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type TaskWithOrchestrator,
} from "@/lib/types/task";

import { AddTaskButton } from "./add-task-button";
import { KanbanBoard } from "./kanban-board";
import { TaskListView } from "./task-list-view";
import { ViewModeSwitch } from "./view-mode-switch";

interface TasksViewProps {
  tasks: TaskWithOrchestrator[];
  nextCursor?: string | null;
  columns?: KanbanColumnDefinition[];
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
  };
}

export function TasksView({
  tasks,
  nextCursor: initialNextCursor,
  columns = KANBAN_COLUMNS,
  labels,
}: TasksViewProps) {
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [items, setItems] = useState<TaskWithOrchestrator[]>(tasks);
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialNextCursor ?? null,
  );
  const [isPending, startTransition] = useTransition();

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
  );
}
