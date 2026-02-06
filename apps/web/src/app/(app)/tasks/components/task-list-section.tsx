import {
  COLUMN_STATUS_COLORS,
  type KanbanColumnId,
  type TaskWithCoworker,
} from "@/lib/types/task";

import { ColumnHeader } from "./column-header";
import { TaskListItem } from "./task-list-item";

interface TaskListSectionProps {
  columnId: KanbanColumnId;
  title: string;
  tasks: TaskWithCoworker[];
  renderTask?: (task: TaskWithCoworker) => React.ReactNode;
}

export function TaskListSection({
  columnId,
  title,
  tasks,
  renderTask,
}: TaskListSectionProps) {
  if (tasks.length === 0) return null;

  return (
    <section className="flex flex-col gap-1">
      <div className="px-4 py-2 sticky top-0 bg-muted/40 backdrop-blur-sm z-10">
        <ColumnHeader
          title={title}
          count={tasks.length}
          statusColorClass={COLUMN_STATUS_COLORS[columnId]}
        />
      </div>

      <div className="flex flex-col divide-y divide-border/50">
        {tasks.map((task) =>
          renderTask ? (
            renderTask(task)
          ) : (
            <TaskListItem key={task.id} task={task} />
          ),
        )}
      </div>
    </section>
  );
}
