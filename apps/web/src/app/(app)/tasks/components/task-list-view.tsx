import { NewTaskButton } from "@/app/components/new-task-button.client";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { EmptyState } from "@/components/common/empty-state";
import type { TaskStatus } from "@/lib/types/core-dto";

import { TaskCard } from "./task-card";
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
    // Cards on a tinted ground below `md`. From `md` up the rows share one
    // surface and a hairline, so the list reads as one table.
    <div className="bg-card-background md:bg-background md:border-border overflow-hidden rounded-xl p-2 md:border md:p-0">
      {hasAnyTasks ? (
        <div className="md:divide-border flex flex-col gap-2 md:gap-0 md:divide-y">
          {tasks.map((task) => (
            <div key={task.id}>
              <div className="md:hidden">
                <TaskCard
                  task={task}
                  compact={compact}
                  statusLabels={statusLabels}
                />
              </div>
              <div className="hidden md:block">
                <TaskListItem
                  task={task}
                  compact={compact}
                  statusLabels={statusLabels}
                />
              </div>
            </div>
          ))}
          {footer ? <div className="py-3 md:px-3">{footer}</div> : null}
        </div>
      ) : (
        <EmptyState description={labels.emptyList} action={<NewTaskButton />} />
      )}
    </div>
  );
}
