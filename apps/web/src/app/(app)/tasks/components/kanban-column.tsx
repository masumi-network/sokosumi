import type { KanbanColumnId, TaskWithCoworker } from "@/lib/types/task";
import { cn } from "@/lib/utils";

import { ColumnHeader } from "./column-header";
import { TaskCard } from "./task-card";

interface KanbanColumnProps {
  columnId?: KanbanColumnId;
  title: string;
  statusColor: string;
  tasks: TaskWithCoworker[];
  footer?: React.ReactNode;
  renderTask?: (task: TaskWithCoworker) => React.ReactNode;
}

export function KanbanColumn({
  columnId,
  title,
  statusColor,
  tasks,
  footer,
  renderTask,
}: KanbanColumnProps) {
  const isEmpty = tasks.length === 0 && !footer;

  return (
    <section
      className={cn(
        "flex min-w-[260px] sm:min-w-[280px] flex-1 flex-col rounded-xl transition-colors",
        "bg-muted/30 border border-transparent",
        isEmpty && "bg-transparent border-dashed border-muted-foreground/20",
      )}
    >
      <div className="sticky top-0 z-10 px-3 pt-3 pb-2">
        <ColumnHeader
          title={title}
          count={tasks.length}
          statusColorClass={statusColor}
        />
      </div>

      <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
        {tasks.map((task) =>
          renderTask ? (
            renderTask(task)
          ) : (
            <TaskCard key={task.id} task={task} />
          ),
        )}
        {footer}
        {isEmpty && (
          <div className="flex flex-1 items-center justify-center py-8">
            <p className="text-muted-foreground/50 text-sm">No tasks</p>
          </div>
        )}
      </div>
    </section>
  );
}
