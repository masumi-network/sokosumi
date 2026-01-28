import {
  COLUMN_STATUS_COLORS,
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type TaskWithOrchestrator,
} from "@/lib/types/task";

import { AddTaskButton } from "./add-task-button";
import { KanbanColumn } from "./kanban-column";

interface KanbanBoardProps {
  tasks: TaskWithOrchestrator[];
  columns: KanbanColumnDefinition[];
  labels: {
    columns: Record<KanbanColumnId, string>;
    addTask: string;
  };
}

export function KanbanBoard({ tasks, columns, labels }: KanbanBoardProps) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {columns.map((column, index) => {
        const columnTasks = tasks.filter((task) => task.columnId === column.id);
        const isFirstColumn = index === 0;

        return (
          <KanbanColumn
            key={column.id}
            title={labels.columns[column.id]}
            statusColor={COLUMN_STATUS_COLORS[column.id]}
            tasks={columnTasks}
            footer={
              isFirstColumn ? (
                <AddTaskButton label={labels.addTask} />
              ) : undefined
            }
          />
        );
      })}
    </div>
  );
}
