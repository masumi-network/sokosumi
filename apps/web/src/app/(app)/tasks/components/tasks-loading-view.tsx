import { Loader2, Plus, SlidersHorizontal } from "lucide-react";
import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import {
  COLUMN_STATUS_COLORS,
  KANBAN_COLUMNS,
  type KanbanColumnId,
} from "@/app/tasks/types/task-board";
import { Button } from "@/components/ui/button";
import type { TasksViewMode } from "@/lib/ui-preferences/tasks-view-mode";
import { cn } from "@/lib/utils";

import { ColumnHeader } from "./column-header";

export interface TasksLoadingLabels {
  tabs: {
    tasks: string;
    jobs: string;
  };
  columns: Record<KanbanColumnId, string>;
  add: string;
  addTask: string;
  display: {
    button: string;
  };
}

interface TasksLoadingViewProps {
  viewMode?: TasksViewMode;
  labels: TasksLoadingLabels;
}

/** Sync shell labels for Instant Navigations / `loading.tsx` (no cookies/i18n). */
export const TASKS_LOADING_DEFAULT_LABELS: TasksLoadingLabels = {
  tabs: {
    tasks: "Tasks",
    jobs: "Jobs",
  },
  columns: {
    backlog: "Backlog",
    todo: "Todo",
    "in-progress": "In Progress",
    "input-required": "Input Required",
    done: "Done",
  },
  add: "New Task",
  addTask: "New Task",
  display: {
    button: "Display",
  },
};

export function TasksPageSkeleton({ viewMode }: { viewMode?: TasksViewMode }) {
  return (
    <div className="w-full px-2">
      <TasksLoadingView
        viewMode={viewMode}
        labels={TASKS_LOADING_DEFAULT_LABELS}
      />
    </div>
  );
}

export function TasksLoadingView({ viewMode, labels }: TasksLoadingViewProps) {
  const resolvedViewMode = viewMode ?? "board";

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-1 flex-col gap-5",
        LIST_MOBILE_CREATE_FAB_CLEARANCE,
      )}
    >
      <div className="flex flex-row items-center justify-between gap-3">
        <div>
          <div className="bg-muted/50 flex items-center gap-1 self-start rounded-lg p-1">
            <div className="bg-background text-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium shadow-sm">
              {labels.tabs.tasks}
            </div>
            <div className="text-muted-foreground rounded-md border-none px-3 py-1.5 text-sm font-medium transition-colors">
              {labels.tabs.jobs}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Button variant="outline" size="sm" className="gap-2" disabled>
            <SlidersHorizontal className="size-4" aria-hidden />
            <span className="hidden sm:inline">{labels.display.button}</span>
          </Button>
          <Button
            size="sm"
            className="hidden gap-1.5 md:inline-flex"
            disabled
            data-tasks-add-task-header-anchor
          >
            <Plus className="size-4" aria-hidden />
            <span className="hidden sm:inline">{labels.add}</span>
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-4",
          resolvedViewMode === "board"
            ? "max-h-[calc(100vh-150px)]"
            : "max-h-full",
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div
            className={cn(
              resolvedViewMode === "board" ? "flex min-h-0 min-w-0 flex-1" : "",
            )}
          >
            {resolvedViewMode === "board" ? (
              <TasksBoardLoading labels={labels} />
            ) : (
              <TasksListLoading />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TasksBoardLoading({ labels }: { labels: TasksLoadingLabels }) {
  return (
    <div className="-mx-2 flex h-full min-h-[calc(100svh-8.5rem)] w-full min-w-0 flex-1 items-stretch gap-3 overflow-x-auto overflow-y-hidden px-2 pb-4 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/80 [&::-webkit-scrollbar-track]:bg-transparent">
      {KANBAN_COLUMNS.map((column, index) => {
        const isFirstColumn = index === 0;

        return (
          <section
            key={column.id}
            className="bg-muted/30 flex h-full min-h-0 min-w-[260px] shrink-0 flex-1 flex-col rounded-xl border border-transparent transition-colors sm:min-w-[280px] lg:min-w-[350px]"
          >
            <div className="sticky top-0 z-10 px-3 pt-3 pb-2">
              <ColumnHeader
                title={labels.columns[column.id]}
                count={0}
                statusColorClass={COLUMN_STATUS_COLORS[column.id]}
              />
            </div>

            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col overflow-y-auto px-2",
                LIST_MOBILE_CREATE_FAB_CLEARANCE,
                "md:pb-2",
              )}
            >
              {isFirstColumn ? (
                <div className="flex flex-1 items-center justify-center py-6">
                  <Loader2
                    className="text-muted-foreground size-5 animate-spin"
                    aria-hidden
                  />
                </div>
              ) : (
                <div className="flex-1" />
              )}
            </div>

            {isFirstColumn ? (
              <div className="px-2 pb-3">
                <Button className="w-full text-xs" variant="ghost" disabled>
                  <Plus className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{labels.addTask}</span>
                </Button>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function TasksListLoading() {
  return (
    <div className="bg-muted/30 border-border/50 -mx-6 overflow-hidden rounded-none border-0 md:mx-0 md:rounded-xl md:border">
      <div className="flex items-center justify-center px-4 py-16">
        <Loader2
          className="text-muted-foreground size-5 animate-spin"
          aria-hidden
        />
      </div>
    </div>
  );
}
