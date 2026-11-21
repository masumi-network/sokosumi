import { TASKS_BOARD_MIN_HEIGHT_CLASS } from "@/app/tasks/constants";
import {
  COLUMN_STATUS_COLORS,
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type TaskWithCoworker,
} from "@/app/tasks/types/task-board";
import { COLUMN_MAIN_STATUS } from "@/app/tasks/utils/task-column";
import { compareTasks, type TasksSort } from "@/app/tasks/utils/task-sort";
import type { TaskStatus } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";
import { BoardEdgeShortcuts } from "./board-edge-shortcuts";
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
    emptyColumn: string;
  };
  columnFooterById?: Partial<Record<KanbanColumnId, React.ReactNode>>;
  /** Tasks not loaded yet per column, so the header counts the whole column. */
  columnHiddenCountById?: Partial<Record<KanbanColumnId, number>>;
  isDragEnabled?: boolean;
  canDragTask?: (task: TaskWithCoworker) => boolean;
  compact?: boolean;
  statusLabels?: Record<TaskStatus, string>;
  /** The order inside each column; the board's default is last updated. */
  sort?: TasksSort;
  /** Search results arrive in relevance order, with the chosen sort within each rank. */
  preserveSearchOrder?: boolean;
}

export function KanbanBoard({
  tasks,
  columns,
  labels,
  columnFooterById,
  columnHiddenCountById,
  isDragEnabled = true,
  canDragTask = () => true,
  compact = false,
  statusLabels,
  sort = "updatedAt",
  preserveSearchOrder = false,
}: KanbanBoardProps) {
  const compare = compareTasks(sort);
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-2",
        TASKS_BOARD_MIN_HEIGHT_CLASS,
      )}
    >
      <BoardEdgeShortcuts
        columns={columns.map((column) => ({
          id: column.id,
          title: labels.columns[column.id],
          statusColor: COLUMN_STATUS_COLORS[column.id],
          count:
            tasks.filter((task) => task.columnId === column.id).length +
            (columnHiddenCountById?.[column.id] ?? 0),
        }))}
      />
      <DragScrollContainer className="-mx-2 flex min-h-0 min-w-0 flex-1 items-stretch gap-3 overflow-x-auto overflow-y-hidden px-2 pb-4 app-scrollbar">
        {columns.map((column) => {
          const columnTasks = tasks.filter(
            (task) => task.columnId === column.id,
          );
          if (!preserveSearchOrder) columnTasks.sort(compare);
          const isDraggableColumn = isDragEnabled && isDnDDragColumn(column.id);
          const isDropTargetColumn =
            isDragEnabled && isDnDDropColumn(column.id);

          const columnContent = (
            <KanbanColumn
              key={column.id}
              id={column.id}
              title={labels.columns[column.id]}
              statusColor={COLUMN_STATUS_COLORS[column.id]}
              tasks={columnTasks}
              hiddenCount={columnHiddenCountById?.[column.id] ?? 0}
              emptyLabel={labels.emptyColumn}
              footer={columnFooterById?.[column.id]}
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
                        quietStatus={COLUMN_MAIN_STATUS[column.id]}
                      />
                    )}
                  </DraggableTask>
                ) : (
                  <TaskCard
                    key={task.id}
                    task={task}
                    compact={compact}
                    statusLabels={statusLabels}
                    quietStatus={COLUMN_MAIN_STATUS[column.id]}
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
    </div>
  );
}
