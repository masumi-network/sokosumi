import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
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
      className={cn(dragHandleProps?.isDragging ? "opacity-70" : null)}
      {...handleProps}
    >
      <Link href={`/tasks/${task.id}`} className="block">
        <Card
          className={cn(
            "hover:bg-foreground/5 py-4",
            dragHandleProps?.isDragging ? "ring-primary/20 ring-1" : null,
          )}
        >
          <CardContent className="space-y-2 px-4">
            <div className="space-y-2">
              <h3 className="line-clamp-2 text-lg leading-tight font-semibold">
                {task.name}
              </h3>
              <TaskStatusBadge
                status={task.status}
                className="rounded-full text-xs font-medium"
              />
            </div>

            <p className="text-muted-foreground line-clamp-2 text-sm">
              {task.descriptionPlain ?? task.description ?? "—"}
            </p>

            <TaskMetaDetails
              coworker={task.coworker}
              commentsCount={task.commentsCount}
              createdAt={task.createdAt}
              variant="card"
            />
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
