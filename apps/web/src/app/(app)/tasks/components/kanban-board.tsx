import {
  COLUMN_STATUS_COLORS,
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type TaskWithCoworker,
} from "@/lib/types/task";

import { AddTaskButton } from "./add-task-button";
import { KanbanColumn } from "./kanban-column";
import { TaskCard } from "./task-card";
import { DraggableTask, DroppableColumn, isDnDColumn } from "./task-dnd";

interface KanbanBoardProps {
  tasks: TaskWithCoworker[];
  columns: KanbanColumnDefinition[];
  labels: {
    columns: Record<KanbanColumnId, string>;
    addTask: string;
    emptyColumn: string;
  };
  isDragEnabled?: boolean;
}

export function KanbanBoard({
  tasks,
  columns,
  labels,
  isDragEnabled = true,
}: KanbanBoardProps) {
  return (
    <div className="-mx-2 flex items-stretch gap-3 overflow-x-auto px-2 pb-4">
      {columns.map((column, index) => {
        const columnTasks = tasks.filter((task) => task.columnId === column.id);
        const isFirstColumn = index === 0;
        const isDraggableColumn = isDragEnabled && isDnDColumn(column.id);

        const columnContent = (
          <KanbanColumn
            key={column.id}
            title={labels.columns[column.id]}
            statusColor={COLUMN_STATUS_COLORS[column.id]}
            tasks={columnTasks}
            emptyLabel={labels.emptyColumn}
            footer={
              isFirstColumn ? (
                <AddTaskButton label={labels.addTask} />
              ) : undefined
            }
            renderTask={(task) =>
              isDraggableColumn ? (
                <DraggableTask
                  key={task.id}
                  id={task.id}
                  columnId={task.columnId}
                >
                  {(dragHandleProps) => (
                    <TaskCard task={task} dragHandleProps={dragHandleProps} />
                  )}
                </DraggableTask>
              ) : (
                <TaskCard key={task.id} task={task} />
              )
            }
          />
        );

        return isDraggableColumn ? (
          <DroppableColumn
            key={column.id}
            id={column.id}
            className="flex flex-1"
          >
            {columnContent}
          </DroppableColumn>
        ) : (
          columnContent
        );
      })}
    </div>
  );
}
