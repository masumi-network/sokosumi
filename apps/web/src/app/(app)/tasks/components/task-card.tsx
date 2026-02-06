import Link from "next/link";

import { type TaskWithCoworker } from "@/lib/types/task";
import { cn } from "@/lib/utils";

import type { DragHandleProps } from "./task-dnd";
import { TaskMetaDetails } from "./task-meta";
import { TaskStatusBadge } from "./task-status-badge";

interface TaskCardProps {
  task: TaskWithCoworker;
  dragHandleProps?: DragHandleProps;
}

export function TaskCard({ task, dragHandleProps }: TaskCardProps) {
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
        dragHandleProps?.isDragging && "opacity-60 scale-[1.02]",
      )}
      {...handleProps}
    >
      <Link href={`/tasks/${task.id}`} className="block">
        <article
          className={cn(
            "bg-background rounded-lg p-3 transition-all duration-200",
            "border border-border/50",
            "hover:border-border hover:shadow-sm",
            "active:scale-[0.99]",
            dragHandleProps?.isDragging && "shadow-lg border-primary/30 ring-2 ring-primary/10",
          )}
        >
          <div className="space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-foreground line-clamp-2 text-sm font-medium leading-snug">
                {task.name}
              </h3>
              <TaskStatusBadge status={task.status} />
            </div>

            {task.descriptionPlain || task.description ? (
              <p className="text-muted-foreground/80 line-clamp-2 text-xs leading-relaxed break-all">
                {task.descriptionPlain ?? task.description}
              </p>
            ) : null}

            <TaskMetaDetails
              coworker={task.coworker}
              commentsCount={task.commentsCount}
              createdAt={task.createdAt}
              variant="card"
            />
          </div>
        </article>
      </Link>
    </div>
  );
}
