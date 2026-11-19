import { SlidersHorizontal } from "lucide-react";
import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import { TASK_CARD_DENSITY_CLASS } from "@/app/tasks/constants";
import {
  COLUMN_STATUS_COLORS,
  KANBAN_COLUMNS,
  type KanbanColumnId,
} from "@/app/tasks/types/task-board";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { TasksViewMode } from "@/lib/ui-preferences/tasks-view-mode";
import { cn } from "@/lib/utils";

import { ColumnHeader } from "./column-header";

/** Placeholder cards per board column, so the skeleton reads as a filled board. */
const BOARD_SKELETON_CARD_COUNTS = [3, 2, 2, 1, 1] as const;
const LIST_SKELETON_ROW_COUNT = 6;

export interface TasksLoadingLabels {
  columns: Record<KanbanColumnId, string>;
  display: {
    button: string;
  };
}

interface TasksLoadingViewProps {
  viewMode?: TasksViewMode;
  /** Matches the `tasks_density` preference, so placeholders take the real size. */
  compact?: boolean;
  labels: TasksLoadingLabels;
}

/** Sync shell labels for Instant Navigations / `loading.tsx` (no cookies/i18n). */
export const TASKS_LOADING_DEFAULT_LABELS: TasksLoadingLabels = {
  columns: {
    backlog: "Backlog",
    todo: "Todo",
    "in-progress": "In progress",
    "input-required": "Input required",
    done: "Done",
  },
  display: {
    button: "Display",
  },
};

export function TasksPageSkeleton({
  viewMode,
  compact,
}: {
  viewMode?: TasksViewMode;
  compact?: boolean;
}) {
  return (
    <div className="w-full">
      <TasksLoadingView
        viewMode={viewMode}
        compact={compact}
        labels={TASKS_LOADING_DEFAULT_LABELS}
      />
    </div>
  );
}

export function TasksLoadingView({
  viewMode,
  compact = false,
  labels,
}: TasksLoadingViewProps) {
  const resolvedViewMode = viewMode ?? "board";

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-1 flex-col gap-5",
        LIST_MOBILE_CREATE_FAB_CLEARANCE,
      )}
    >
      <div className="flex flex-row items-center justify-end gap-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            variant="outline"
            size="sm"
            className="hit-area"
            aria-label={labels.display.button}
            disabled
          >
            <SlidersHorizontal className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-4",
          resolvedViewMode === "board"
            ? "max-h-[calc(100dvh-150px)]"
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
              <TasksBoardLoading labels={labels} compact={compact} />
            ) : (
              <TasksListLoading compact={compact} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TasksBoardLoading({
  labels,
  compact,
}: {
  labels: TasksLoadingLabels;
  compact: boolean;
}) {
  return (
    <div className="-mx-2 flex size-full min-h-[calc(100dvh-8.5rem)] min-w-0 flex-1 items-stretch gap-3 overflow-x-auto overflow-y-hidden px-2 pb-4 app-scrollbar">
      {KANBAN_COLUMNS.map((column, index) => {
        const cardCount = BOARD_SKELETON_CARD_COUNTS[index] ?? 1;

        return (
          <section
            key={column.id}
            className="bg-card-background flex h-full min-h-0 min-w-[260px] shrink-0 flex-1 flex-col rounded-xl transition-colors sm:min-w-[280px] lg:min-w-[350px]"
          >
            <div className="sticky top-0 z-10">
              <ColumnHeader
                title={labels.columns[column.id]}
                statusColorClass={COLUMN_STATUS_COLORS[column.id]}
              />
            </div>

            <div
              aria-hidden
              className={cn(
                "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-b-xl px-2 [scrollbar-gutter:stable] app-scrollbar",
                LIST_MOBILE_CREATE_FAB_CLEARANCE,
                "md:pb-2",
              )}
            >
              {Array.from({ length: cardCount }, (_, cardIndex) => (
                <TaskCardSkeleton
                  key={`${column.id}-${cardIndex}`}
                  compact={compact}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TasksListLoading({ compact }: { compact: boolean }) {
  return (
    <div className="bg-card-background md:bg-background md:border-border overflow-hidden rounded-xl p-2 md:border md:p-0">
      <div
        aria-hidden
        className="md:divide-border flex flex-col gap-2 md:gap-0 md:divide-y"
      >
        {Array.from({ length: LIST_SKELETON_ROW_COUNT }, (_, rowIndex) => (
          // Mirrors `TaskListView`: cards below `md`, rows from `md` up.
          <div key={`row-${rowIndex}`}>
            <div className="md:hidden">
              <TaskCardSkeleton compact={compact} />
            </div>
            <div
              data-testid="task-row-skeleton"
              className={cn(
                "hidden items-center gap-3 px-3 md:flex",
                compact ? "py-1.5" : "py-2.5",
              )}
            >
              <TextLineSkeleton className="w-2/5 text-sm" />
              <TextLineSkeleton className="ms-auto w-32 shrink-0 text-xs lg:w-40" />
              <Skeleton className="size-5 shrink-0 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Same frame as `TaskCard` so content does not jump on load. */
function TaskCardSkeleton({ compact }: { compact: boolean }) {
  return (
    <div
      data-testid="task-card-skeleton"
      className={cn(
        "bg-background border-border rounded-lg border",
        TASK_CARD_DENSITY_CLASS[compact ? "compact" : "normal"],
      )}
    >
      <TextLineSkeleton className="w-20 text-xs leading-4" />
      <TextLineSkeleton className="w-4/5 text-sm leading-5" />
      <div className="flex h-5 items-center justify-between gap-2">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="size-5 rounded-full" />
      </div>
    </div>
  );
}

/** One blank text line, so the bar takes the real line height of its type size. */
function TextLineSkeleton({ className }: { className: string }) {
  return (
    <Skeleton className={cn("text-transparent select-none", className)}>
      &nbsp;
    </Skeleton>
  );
}
