import {
  COLUMN_STATUS_COLORS,
  type KanbanColumnId,
  type TaskWithOrchestrator,
} from "@/lib/types/task";

import { ColumnHeader } from "./column-header";
import { TaskListItem } from "./task-list-item";

interface TaskListSectionProps {
  columnId: KanbanColumnId;
  title: string;
  tasks: TaskWithOrchestrator[];
}

export function TaskListSection({
  columnId,
  title,
  tasks,
}: TaskListSectionProps) {
  return (
    <section className="flex flex-col gap-2 border-b px-4 py-2 last:border-b-0">
      <ColumnHeader
        title={title}
        count={tasks.length}
        statusColorClass={COLUMN_STATUS_COLORS[columnId]}
      />

      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskListItem key={task.id} task={task} />
        ))}
      </div>
    </section>
  );
}
