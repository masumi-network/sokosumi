import {
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type TaskWithOrchestrator,
} from "@/lib/types/task";

import { TaskListSection } from "./task-list-section";

interface TaskListViewProps {
  tasks: TaskWithOrchestrator[];
  columns: KanbanColumnDefinition[];
  labels: {
    columns: Record<KanbanColumnId, string>;
  };
}

export function TaskListView({ tasks, columns, labels }: TaskListViewProps) {
  const orderedColumns = [...columns].reverse();

  return (
    <div className="bg-muted/40 rounded-xl py-4">
      {orderedColumns.map((column) => {
        const columnTasks = tasks.filter((task) => task.columnId === column.id);

        return (
          <TaskListSection
            key={column.id}
            columnId={column.id}
            title={labels.columns[column.id]}
            tasks={columnTasks}
          />
        );
      })}
    </div>
  );
}
