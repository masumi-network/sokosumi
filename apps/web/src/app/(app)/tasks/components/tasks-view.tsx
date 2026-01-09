"use client";

import { useState } from "react";

import { KANBAN_COLUMNS } from "@/app/tasks/data/mock-data";
import {
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type TaskCardData,
} from "@/app/tasks/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { KanbanBoard } from "./kanban-board";
import { TaskListView } from "./task-list-view";
import { ViewModeSwitch } from "./view-mode-switch";

interface TasksViewProps {
  tasks: TaskCardData[];
  columns?: KanbanColumnDefinition[];
  labels: {
    tabs: {
      tasks: string;
      jobs: string;
    };
    columns: Record<KanbanColumnId, string>;
    addTask: string;
    taskCard: {
      budget: string;
    };
    jobsPlaceholder: string;
    display: {
      button: string;
      list: string;
      board: string;
    };
    listPlaceholder: string;
  };
}

export function TasksView({
  tasks,
  columns = KANBAN_COLUMNS,
  labels,
}: TasksViewProps) {
  const [viewMode, setViewMode] = useState<"board" | "list">("board");

  return (
    <Tabs defaultValue="tasks" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="tasks">{labels.tabs.tasks}</TabsTrigger>
          <TabsTrigger value="jobs">{labels.tabs.jobs}</TabsTrigger>
        </TabsList>
        <ViewModeSwitch
          value={viewMode}
          onChange={setViewMode}
          labels={labels.display}
        />
      </div>

      <TabsContent value="tasks" className="flex flex-col gap-4">
        {viewMode === "board" ? (
          <KanbanBoard
            tasks={tasks}
            columns={columns}
            labels={{
              columns: labels.columns,
              addTask: labels.addTask,
              taskCard: labels.taskCard,
            }}
          />
        ) : (
          <TaskListView
            tasks={tasks}
            columns={columns}
            labels={{
              columns: labels.columns,
              taskCard: labels.taskCard,
            }}
          />
        )}
      </TabsContent>

      <TabsContent value="jobs">
        <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-sm">
          {labels.jobsPlaceholder}
        </div>
      </TabsContent>
    </Tabs>
  );
}
