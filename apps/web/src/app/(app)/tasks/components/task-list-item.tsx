"use client";

import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { TaskStatus } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { TaskDetailLink } from "./task-detail-link";
import type { DragHandleProps } from "./task-dnd";
import { TaskMetaDetails } from "./task-meta";
import { TaskStatusBadge } from "./task-status-badge";

interface TaskListItemProps {
  task: TaskWithCoworker;
  dragHandleProps?: DragHandleProps;
  isOverlay?: boolean;
  compact?: boolean;
  statusLabels?: Record<TaskStatus, string>;
}

export function TaskListItem({
  task,
  dragHandleProps,
  isOverlay = false,
  compact = false,
  statusLabels,
}: TaskListItemProps) {
  const handleProps = dragHandleProps
    ? {
        ...dragHandleProps.attributes,
        ...dragHandleProps.listeners,
      }
    : null;

  return (
    <div
      className={cn(
        "group",
        dragHandleProps && "cursor-grab",
        (dragHandleProps?.isDragging || isOverlay) && "opacity-60",
      )}
      {...handleProps}
    >
      <TaskDetailLink
        href={`/tasks/${task.id}`}
        className={cn(
          "flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4",
          "-mx-2 rounded-lg px-4 py-3 transition-colors",
          "hover:bg-muted/50",
          "active:scale-[0.995]",
          (dragHandleProps?.isDragging || isOverlay) && "bg-muted/70 shadow-sm",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-foreground line-clamp-1 text-sm font-medium">
              {task.name}
            </span>
            {!compact && (
              <p className="text-muted-foreground/70 line-clamp-1 text-xs break-all">
                {task.descriptionPlain ?? task.description ?? "—"}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 text-xs sm:gap-4">
          <TaskStatusBadge
            status={task.status}
            label={statusLabels?.[task.status]}
            showDot={task.columnId === "in-progress"}
            className="w-fit shrink-0 rounded-sm"
          />
          <TaskMetaDetails
            owner={task.user}
            coworker={task.coworker}
            commentsCount={task.commentsCount}
            createdAt={task.createdAt}
            variant="list"
          />
        </div>
      </TaskDetailLink>
    </div>
  );
}
