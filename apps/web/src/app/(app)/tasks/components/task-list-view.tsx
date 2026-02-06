import {
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type TaskWithCoworker,
} from "@/lib/types/task";

import { DraggableTask, DroppableColumn, isDnDColumn } from "./task-dnd";
import { TaskListItem } from "./task-list-item";
import { TaskListSection } from "./task-list-section";

interface TaskListViewProps {
  tasks: TaskWithCoworker[];
  columns: KanbanColumnDefinition[];
  labels: {
    columns: Record<KanbanColumnId, string>;
  };
  isDragEnabled?: boolean;
}

export function TaskListView({
  tasks,
  columns,
  labels,
  isDragEnabled = true,
}: TaskListViewProps) {
  const orderedColumns = [...columns].reverse();
  const hasAnyTasks = tasks.length > 0;

  return (
    <div className="bg-muted/30 rounded-xl border border-border/50 overflow-hidden">
      {hasAnyTasks ? (
        <div className="divide-y divide-border/50">
          {orderedColumns.map((column) => {
            const columnTasks = tasks.filter((task) => task.columnId === column.id);
            const isDraggableColumn = isDragEnabled && isDnDColumn(column.id);

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
      ) : (
        <div className="flex items-center justify-center py-16 text-muted-foreground/50 text-sm">
          No tasks yet
        </div>
      )}
    </div>
  );
}
