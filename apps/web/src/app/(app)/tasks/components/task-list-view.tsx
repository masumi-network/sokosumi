import { compareTasksDesc } from "@/app/tasks/utils/task-sort";
import type { TaskStatus } from "@/lib/types/core-dto";
import type {
  KanbanColumnDefinition,
  KanbanColumnId,
  TaskWithCoworker,
} from "@/lib/types/task";

import { DraggableTask, DroppableColumn, isDnDColumn } from "./task-dnd";
import { TaskListItem } from "./task-list-item";
import { TaskListSection } from "./task-list-section";

interface TaskListViewProps {
  tasks: TaskWithCoworker[];
  columns: KanbanColumnDefinition[];
  labels: {
    columns: Record<KanbanColumnId, string>;
    emptyList: string;
    emptySection: string;
  };
  sectionFooterById?: Partial<Record<KanbanColumnId, React.ReactNode>>;
  isDragEnabled?: boolean;
  canDragTask?: (task: TaskWithCoworker) => boolean;
  compact?: boolean;
  statusLabels?: Record<TaskStatus, string>;
}

export function TaskListView({
  tasks,
  columns,
  labels,
  sectionFooterById,
  isDragEnabled = true,
  canDragTask = () => true,
  compact = false,
  statusLabels,
}: TaskListViewProps) {
  const orderedColumns = [...columns].reverse();
  const hasAnyTasks = tasks.length > 0;

  return (
    <div className="bg-muted/30 border-border/50 overflow-hidden rounded-xl border">
      {hasAnyTasks ? (
        <div className="divide-border/50 divide-y">
          {orderedColumns.map((column) => {
            const columnTasks = tasks
              .filter((task) => task.columnId === column.id)
              .sort(compareTasksDesc);
            const isDraggableColumn = isDragEnabled && isDnDColumn(column.id);

            const sectionContent = (
              <TaskListSection
                key={column.id}
                columnId={column.id}
                title={labels.columns[column.id]}
                tasks={columnTasks}
                emptyLabel={labels.emptySection}
                footer={sectionFooterById?.[column.id]}
                renderTask={(task) =>
                  isDraggableColumn && canDragTask(task) ? (
                    <DraggableTask
                      key={task.id}
                      id={task.id}
                      columnId={task.columnId}
                    >
                      {(dragHandleProps) => (
                        <TaskListItem
                          task={task}
                          dragHandleProps={dragHandleProps}
                          compact={compact}
                          statusLabels={statusLabels}
                        />
                      )}
                    </DraggableTask>
                  ) : (
                    <TaskListItem
                      key={task.id}
                      task={task}
                      compact={compact}
                      statusLabels={statusLabels}
                    />
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
        <div className="text-muted-foreground/50 flex items-center justify-center py-16 text-sm">
          {labels.emptyList}
        </div>
      )}
    </div>
  );
}
