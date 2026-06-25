import {
  compareScheduledTasksAsc,
  compareTasksDesc,
} from "@/app/tasks/utils/task-sort";
import type { TaskStatus } from "@/lib/types/core-dto";
import {
  COLUMN_STATUS_COLORS,
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type TaskWithCoworker,
} from "@/lib/types/task";

import { AddTaskButton } from "./add-task-button";
import { DragScrollContainer } from "./drag-scroll-container";
import { KanbanColumn } from "./kanban-column";
import { TaskCard } from "./task-card";
import {
  DraggableTask,
  DroppableColumn,
  isDnDDragColumn,
  isDnDDropColumn,
} from "./task-dnd";

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
  statusLabels?: Record<TaskStatus, string>;
}

export function KanbanBoard({
  tasks,
  columns,
  labels,
  columnFooterById,
  isDragEnabled = true,
  canDragTask = () => true,
  compact = false,
  statusLabels,
}: KanbanBoardProps) {
  return (
    <DragScrollContainer className="-mx-2 flex h-full min-h-[calc(100svh-8.5rem)] w-full min-w-0 flex-1 items-stretch gap-3 overflow-x-auto overflow-y-hidden px-2 pb-4 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/80 [&::-webkit-scrollbar-track]:bg-transparent">
      {columns.map((column, index) => {
        const columnTasks = tasks
          .filter((task) => task.columnId === column.id)
          .sort(
            column.id === "scheduled"
              ? compareScheduledTasksAsc
              : compareTasksDesc,
          );
        const isFirstColumn = index === 0;
        const isDraggableColumn = isDragEnabled && isDnDDragColumn(column.id);
        const isDropTargetColumn = isDragEnabled && isDnDDropColumn(column.id);
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
                      statusLabels={statusLabels}
                    />
                  )}
                </DraggableTask>
              ) : (
                <TaskCard
                  key={task.id}
                  task={task}
                  compact={compact}
                  statusLabels={statusLabels}
                />
              )
            }
          />
        );

        return isDropTargetColumn ? (
          <DroppableColumn
            key={column.id}
            id={column.id}
            className="flex h-full min-h-0 shrink-0 flex-1"
          >
            {columnContent}
          </DroppableColumn>
        ) : (
          columnContent
        );
      })}
    </DragScrollContainer>
  );
}
