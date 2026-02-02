import Link from "next/link";

import { type TaskWithOrchestrator } from "@/lib/types/task";
import { cn } from "@/lib/utils";

import type { DragHandleProps } from "./task-dnd";
import { TaskMetaDetails } from "./task-meta";
import { TaskStatusBadge } from "./task-status-badge";

interface TaskListItemProps {
  task: TaskWithOrchestrator;
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
        "flex items-start gap-2",
        dragHandleProps?.isDragging ? "opacity-70" : null,
      )}
      {...handleProps}
    >
      <Link
        href={`/tasks/${task.id}`}
        className={cn(
          "bg-card/70 hover:bg-foreground/5 flex flex-1 flex-col gap-2 rounded-lg border px-3 py-3 transition sm:flex-row sm:items-center sm:gap-3",
          dragHandleProps?.isDragging ? "ring-primary/20 ring-1" : null,
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="line-clamp-1 text-sm font-semibold">
                {task.name}
              </span>
            </div>
            <p className="text-muted-foreground line-clamp-1 text-xs">
              {task.descriptionPlain ?? task.description ?? "—"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-4 text-xs">
          <TaskStatusBadge
            status={task.status}
            className="rounded-full font-medium"
          />
          <TaskMetaDetails
            orchestrator={task.orchestrator}
            commentsCount={task.commentsCount}
            createdAt={task.createdAt}
            variant="list"
          />
        </div>
      </Link>
    </div>
  );
}
