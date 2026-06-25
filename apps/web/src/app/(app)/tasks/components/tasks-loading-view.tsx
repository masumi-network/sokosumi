import { Loader2, Plus, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  COLUMN_STATUS_COLORS,
  KANBAN_COLUMNS,
  type KanbanColumnId,
} from "@/lib/types/task";
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

export function TasksLoadingView({ viewMode, labels }: TasksLoadingViewProps) {
  const resolvedViewMode = viewMode ?? "board";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-5">
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
          <Button size="sm" className="gap-1.5" disabled>
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
              resolvedViewMode === "board"
                ? "flex min-h-0 min-w-0 flex-1 overflow-hidden"
                : "",
            )}
          >
            {resolvedViewMode === "board" ? (
              <TasksBoardLoading labels={labels} />
            ) : (
              <TasksListLoading labels={labels} />
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

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
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

function TasksListLoading({ labels }: { labels: TasksLoadingLabels }) {
  const orderedColumns = [...KANBAN_COLUMNS].reverse();

  return (
    <div className="bg-muted/30 border-border/50 w-full overflow-hidden rounded-xl border">
      <div className="divide-border/50 divide-y">
        {orderedColumns.map((column, index) => {
          const isFirstVisibleSection = index === 0;

          return (
            <section key={column.id} className="flex flex-col gap-1">
              <div className="bg-muted/40 sticky top-0 z-10 px-4 py-2 backdrop-blur-sm">
                <ColumnHeader
                  title={labels.columns[column.id]}
                  count={0}
                  statusColorClass={COLUMN_STATUS_COLORS[column.id]}
                />
              </div>
              {isFirstVisibleSection ? (
                <div className="flex items-center justify-center px-4 py-6">
                  <Loader2
                    className="text-muted-foreground size-5 animate-spin"
                    aria-hidden
                  />
                </div>
              ) : (
                <div className="px-4 py-6" />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
