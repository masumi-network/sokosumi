import type { TaskStatus } from "@sokosumi/utils";

import type { TaskWithCoworker } from "@/lib/types/task";
import { cn } from "@/lib/utils";
import { TaskDetailLink } from "./task-detail-link";
import type { DragHandleProps } from "./task-dnd";
import { TaskMetaDetails } from "./task-meta";
import { TaskStatusBadge } from "./task-status-badge";

interface TaskCardProps {
  task: TaskWithCoworker;
  dragHandleProps?: DragHandleProps;
  compact?: boolean;
  statusLabels?: Record<TaskStatus, string>;
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
              "border-primary/30 ring-primary/10 shadow-lg ring-2",
          )}
        >
          <div className="space-y-2.5">
            <div className="flex flex-col gap-2">
              <TaskStatusBadge
                status={task.status}
                label={statusLabels?.[task.status]}
                showDot={task.columnId === "in-progress"}
                className="w-fit self-start rounded-sm"
              />
              <h3 className="text-foreground line-clamp-2 text-md leading-snug font-medium">
                {task.name}
              </h3>
            </div>

            {!compact && (task.descriptionPlain || task.description) ? (
              <div className="space-y-1.5">
                <p className="text-muted-foreground/80 line-clamp-2 text-xs leading-relaxed break-all">
                  {task.descriptionPlain ?? task.description}
                </p>
              </div>
            ) : null}

            <TaskMetaDetails
              owner={task.user}
              coworker={task.coworker}
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
