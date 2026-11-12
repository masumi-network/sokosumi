"use client";

import { TaskStatus } from "@sokosumi/core-client";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { taskHref } from "@/app/tasks/utils/task-href";
import { cn } from "@/lib/utils";
import { TaskDetailLink } from "./task-detail-link";
import type { DragHandleProps } from "./task-dnd";
import { TaskDueBadge } from "./task-due-badge";
import { TaskMetaDetails } from "./task-meta";
import { TaskPriorityMark } from "./task-priority-mark";
import { TaskPrivateIndicator } from "./task-private-indicator";
import { TaskRunAtBadge } from "./task-run-at-badge";
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

  const rowClassName = cn(
    "flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4",
    "bg-background rounded-lg border border-border px-4 py-3 transition-colors",
    "hover:bg-accent",
    "press content-in",
    (dragHandleProps?.isDragging || isOverlay) && "bg-senary shadow-sm",
  );
  const row = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <TaskPriorityMark priority={task.priority} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            {task.identifier ? (
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {task.identifier}
              </span>
            ) : null}
            <span className="text-foreground line-clamp-1 text-sm font-medium">
              {task.name}
            </span>
          </div>
          {!compact && (
            <p className="text-muted-foreground line-clamp-1 text-xs break-all">
              {task.descriptionPlain ?? "—"}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 text-xs sm:gap-4">
        <div className="flex items-center gap-1.5">
          <TaskStatusBadge
            status={task.status}
            label={statusLabels?.[task.status]}
            className="w-fit shrink-0 rounded-sm"
          />
          <TaskPrivateIndicator visibility={task.visibility} />
        </div>
        {task.runAt ? <TaskRunAtBadge runAt={task.runAt} /> : null}
        {task.dueOn ? (
          <TaskDueBadge dueOn={task.dueOn} status={task.status} />
        ) : null}
        <TaskMetaDetails
          project={compact ? null : task.project}
          assignee={task.assignee}
          participants={task.participants}
          commentsCount={task.commentsCount}
          createdAt={task.createdAt}
          variant="list"
        />
      </div>
    </>
  );

  return (
    <div
      className={cn(
        "group",
        dragHandleProps && "cursor-grab",
        (dragHandleProps?.isDragging || isOverlay || task.isPending) &&
          "opacity-60",
      )}
      {...handleProps}
    >
      {task.isPending ? (
        // No page to open yet: the row is plain content until the create lands.
        <div aria-busy className={rowClassName}>
          {row}
        </div>
      ) : (
        <TaskDetailLink href={taskHref(task)} className={rowClassName}>
          {row}
        </TaskDetailLink>
      )}
    </div>
  );
}
