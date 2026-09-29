import { NewTaskEmptyAction } from "@/app/components/new-task-empty-action.client";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { EmptyState } from "@/components/common/empty-state";
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
    <div className="bg-card-background overflow-hidden rounded-xl p-2">
      {hasAnyTasks ? (
        <div className="flex flex-col gap-2">
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
        <EmptyState
          description={labels.emptyList}
          action={<NewTaskEmptyAction />}
        />
      )}
    </div>
  );
}
// before-state preview marker
