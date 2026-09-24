"use client";

import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import type { TaskStatus as TaskStatusType } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";
import { TaskDetailLink } from "./task-detail-link";
import type { DragHandleProps } from "./task-dnd";
import { TaskMetaDetails } from "./task-meta";
import { TaskPrivateIndicator } from "./task-private-indicator";
import { TaskRunAtBadge } from "./task-run-at-badge";
import { TaskStatusBadge } from "./task-status-badge";

interface TaskCardProps {
  task: TaskWithCoworker;
  dragHandleProps?: DragHandleProps;
  compact?: boolean;
  statusLabels?: Record<TaskStatusType, string>;
}

export function TaskCard({
  task,
  dragHandleProps,
  compact = false,
  statusLabels,
}: TaskCardProps) {
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
        dragHandleProps?.isDragging && "scale-[1.02] opacity-60",
      )}
      {...handleProps}
    >
      <TaskDetailLink href={`/tasks/${task.id}`} className="block">
        <article
          className={cn(
            "bg-background rounded-lg p-3 transition-all duration-200",
            "border-border border",
            "hover:border-primary hover:shadow-sm",
            "active:scale-[0.99]",
            dragHandleProps?.isDragging &&
              "border-primary-tertiary ring-ring-halo shadow-lg ring-2",
          )}
        >
          <div className="space-y-2.5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TaskStatusBadge
                  status={task.status}
                  label={statusLabels?.[task.status]}
                  className="w-fit rounded-sm"
                />
                <TaskPrivateIndicator visibility={task.visibility} />
              </div>
              <h3 className="text-foreground line-clamp-2 text-sm leading-snug font-medium">
                {task.name}
              </h3>
            </div>

            {!compact && task.descriptionPlain ? (
              <div className="space-y-1.5">
                <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed break-all">
                  {task.descriptionPlain}
                </p>
              </div>
            ) : null}

            {task.runAt ? (
              <TaskRunAtBadge runAt={task.runAt} className="flex" />
            ) : null}

            <TaskMetaDetails
              project={task.project}
              assignee={task.assignee}
              participants={task.participants}
              commentsCount={task.commentsCount}
              createdAt={task.createdAt}
              variant="card"
            />
          </div>
        </article>
      </TaskDetailLink>
    </div>
  );
}
