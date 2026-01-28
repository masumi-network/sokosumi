import Link from "next/link";

import { type TaskWithOrchestrator } from "@/lib/types/task";

import { TaskMetaDetails } from "./task-meta";
import { TaskStatusBadge } from "./task-status-badge";

interface TaskListItemProps {
  task: TaskWithOrchestrator;
}

export function TaskListItem({ task }: TaskListItemProps) {
  return (
    <Link
      href={`/tasks/${task.id}`}
      className="bg-card/70 hover:bg-foreground/5 flex flex-col gap-2 rounded-lg border px-3 py-3 transition sm:flex-row sm:items-center sm:gap-3"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold">{task.name}</span>
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
  );
}
