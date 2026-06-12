import { compareTasksDesc } from "@/app/tasks/utils/task-sort";
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
  columnFooterById?: Partial<Record<KanbanColumnId, React.ReactNode>>;
  isDragEnabled?: boolean;
  canDragTask?: (task: TaskWithCoworker) => boolean;
  compact?: boolean;
}

export function KanbanBoard({
  tasks,
  columns,
  labels,
  columnFooterById,
  isDragEnabled = true,
  canDragTask = () => true,
  compact = false,
}: KanbanBoardProps) {
  return (
    <div className="-mx-2 flex h-full min-h-[calc(100svh-8.5rem)] flex-1 items-stretch gap-3 overflow-x-auto overflow-y-hidden px-2 pb-4">
      {columns.map((column, index) => {
        const columnTasks = tasks
          .filter((task) => task.columnId === column.id)
          .sort(compareTasksDesc);
        const isFirstColumn = index === 0;
        const isDraggableColumn = isDragEnabled && isDnDColumn(column.id);
        const columnFooter = columnFooterById?.[column.id];
        const footer = isFirstColumn ? (
          columnFooter ? (
            <div className="flex flex-col gap-2">
              {columnFooter}
              <AddTaskButton label={labels.addTask} />
            </div>
          ) : (
            <AddTaskButton label={labels.addTask} />
          )
        ) : (
          columnFooter
        );

        const columnContent = (
          <KanbanColumn
            key={column.id}
            title={labels.columns[column.id]}
            statusColor={COLUMN_STATUS_COLORS[column.id]}
            tasks={columnTasks}
            emptyLabel={labels.emptyColumn}
            footer={footer}
            renderTask={(task) =>
              isDraggableColumn && canDragTask(task) ? (
                <DraggableTask
                  key={task.id}
                  id={task.id}
                  columnId={task.columnId}
                >
                  {(dragHandleProps) => (
                    <TaskCard
                      task={task}
                      dragHandleProps={dragHandleProps}
                      compact={compact}
                    />
                  )}
                </DraggableTask>
              ) : (
                <TaskCard key={task.id} task={task} compact={compact} />
              )
            }
          />
        );

        return isDraggableColumn ? (
          <DroppableColumn
            key={column.id}
            id={column.id}
            className="flex h-full min-h-0 flex-1"
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
