import type { TaskWithCoworker } from "@/lib/types/task";
import { cn } from "@/lib/utils";
import { TaskCardOwner } from "./task-card-owner";
import { TaskDetailLink } from "./task-detail-link";
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
        dragHandleProps && "cursor-grab",
        dragHandleProps?.isDragging && "scale-[1.02] opacity-60",
      )}
      {...handleProps}
    >
      <TaskDetailLink href={`/tasks/${task.id}`} className="block">
        <article
          className={cn(
            "bg-background rounded-lg p-3 transition-all duration-200",
            "border-border/50 border",
            "hover:border-border hover:shadow-sm",
            "active:scale-[0.99]",
            dragHandleProps?.isDragging &&
              "border-primary/30 ring-primary/10 shadow-lg ring-2",
          )}
        >
          <div className="space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-foreground line-clamp-2 text-sm leading-snug font-medium">
                {task.name}
              </h3>
              <TaskStatusBadge status={task.status} />
            </div>

            <div className="space-y-1.5">
              {task.descriptionPlain || task.description ? (
                <p className="text-muted-foreground/80 line-clamp-2 text-xs leading-relaxed break-all">
                  {task.descriptionPlain ?? task.description}
                </p>
              ) : null}
              <TaskCardOwner user={task.user} />
            </div>

            <TaskMetaDetails
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
