import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import type { TaskStatus } from "@/lib/types/core-dto";

import { TaskListItem } from "./task-list-item";

interface TaskListViewProps {
  tasks: TaskWithCoworker[];
  labels: {
    emptyList: string;
  };
  footer?: React.ReactNode;
  compact?: boolean;
  statusLabels?: Record<TaskStatus, string>;
}

export function TaskListView({
  tasks,
  labels,
  footer,
  compact = false,
  statusLabels,
}: TaskListViewProps) {
  const hasAnyTasks = tasks.length > 0;

  return (
    <div className="bg-muted/30 border-border/50 -mx-6 overflow-hidden rounded-none border-0 md:mx-0 md:rounded-xl md:border">
      {hasAnyTasks ? (
        <div className="divide-border/50 divide-y px-2">
          {tasks.map((task) => (
            <TaskListItem
              key={task.id}
              task={task}
              compact={compact}
              statusLabels={statusLabels}
            />
          ))}
          {footer ? <div className="py-3">{footer}</div> : null}
        </div>
      ) : (
        <div className="text-muted-foreground/50 flex items-center justify-center py-16 text-sm">
          {labels.emptyList}
        </div>
      )}
    </div>
  );
}
