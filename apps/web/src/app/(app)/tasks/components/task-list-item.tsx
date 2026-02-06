import Link from "next/link";

import { type TaskWithCoworker } from "@/lib/types/task";
import { cn } from "@/lib/utils";

import type { DragHandleProps } from "./task-dnd";
import { TaskMetaDetails } from "./task-meta";
import { TaskStatusBadge } from "./task-status-badge";

interface TaskListItemProps {
  task: TaskWithCoworker;
  dragHandleProps?: DragHandleProps;
}

export function TaskListItem({ task, dragHandleProps }: TaskListItemProps) {
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
        dragHandleProps?.isDragging && "opacity-60",
      )}
      {...handleProps}
    >
      <Link
        href={`/tasks/${task.id}`}
        className={cn(
          "flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4",
          "px-4 py-3 -mx-2 rounded-lg transition-colors",
          "hover:bg-muted/50",
          "active:scale-[0.995]",
          dragHandleProps?.isDragging && "bg-muted/70 shadow-sm",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-foreground line-clamp-1 text-sm font-medium">
              {task.name}
            </span>
            <p className="text-muted-foreground/70 line-clamp-1 text-xs break-all">
              {task.descriptionPlain ?? task.description ?? "—"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 text-xs shrink-0">
          <TaskStatusBadge status={task.status} />
          <TaskMetaDetails
            coworker={task.coworker}
            commentsCount={task.commentsCount}
            createdAt={task.createdAt}
            variant="list"
          />
        </div>
      </Link>
    </div>
  );
}
