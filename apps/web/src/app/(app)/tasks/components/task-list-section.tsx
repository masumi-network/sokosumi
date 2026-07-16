import {
  COLUMN_STATUS_COLORS,
  type KanbanColumnId,
  type TaskWithCoworker,
} from "@/app/tasks/types/task-board";

import { ColumnHeader } from "./column-header";
import { TaskListItem } from "./task-list-item";

interface TaskListSectionProps {
  columnId: KanbanColumnId;
  title: string;
  tasks: TaskWithCoworker[];
  emptyLabel: string;
  footer?: React.ReactNode;
  renderTask?: (task: TaskWithCoworker) => React.ReactNode;
}

export function TaskListSection({
  columnId,
  title,
  tasks,
  emptyLabel,
  footer,
  renderTask,
}: TaskListSectionProps) {
  return (
    <section className="flex flex-col gap-1">
      <div className="bg-muted/40 sticky top-0 z-10 px-4 py-2 backdrop-blur-sm">
        <ColumnHeader
          title={title}
          count={tasks.length}
          statusColorClass={COLUMN_STATUS_COLORS[columnId]}
        />
      </div>

      <div className="divide-border/50 flex flex-col divide-y">
        {tasks.length > 0 ? (
          tasks.map((task) =>
            renderTask ? (
              renderTask(task)
            ) : (
              <TaskListItem key={task.id} task={task} />
            ),
          )
        ) : (
          <div className="text-muted-foreground px-4 py-3 text-sm">
            {emptyLabel}
          </div>
        )}
      </div>
      {footer ? <div className="px-2 py-3">{footer}</div> : null}
    </section>
  );
}
