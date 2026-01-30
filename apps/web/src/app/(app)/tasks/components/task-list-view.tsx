import {
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type TaskWithOrchestrator,
} from "@/lib/types/task";

import { DraggableTask, DroppableColumn, isDnDColumn } from "./task-dnd";
import { TaskListItem } from "./task-list-item";
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
        const isDraggableColumn = isDnDColumn(column.id);

        const sectionContent = (
          <TaskListSection
            key={column.id}
            columnId={column.id}
            title={labels.columns[column.id]}
            tasks={columnTasks}
            renderTask={(task) =>
              isDraggableColumn ? (
                <DraggableTask
                  key={task.id}
                  id={task.id}
                  columnId={task.columnId}
                >
                  {(dragHandleProps) => (
                    <TaskListItem
                      task={task}
                      dragHandleProps={dragHandleProps}
                    />
                  )}
                </DraggableTask>
              ) : (
                <TaskListItem key={task.id} task={task} />
              )
            }
          />
        );

        return isDraggableColumn ? (
          <DroppableColumn key={column.id} id={column.id} className="block">
            {sectionContent}
          </DroppableColumn>
        ) : (
          sectionContent
        );
      })}
    </div>
  );
}
