import {
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type TaskCardData,
} from "@/app/tasks/types";

import { TaskListSection } from "./task-list-section";

interface TaskListViewProps {
  tasks: TaskCardData[];
  columns: KanbanColumnDefinition[];
  labels: {
    columns: Record<KanbanColumnId, string>;
    taskCard: {
      budget: string;
    };
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
            taskLabels={labels.taskCard}
          />
        );
      })}
    </div>
  );
}
