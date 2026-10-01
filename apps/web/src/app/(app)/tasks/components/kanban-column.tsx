import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { cn } from "@/lib/utils";
import { BOARD_COLUMN_CLASS } from "./board-classes";

import { ColumnHeader } from "./column-header";
import { TaskCard } from "./task-card";

interface KanbanColumnProps {
  title: string;
  statusColor: string;
  tasks: TaskWithCoworker[];
  emptyLabel: string;
  footer?: React.ReactNode;
  renderTask?: (task: TaskWithCoworker) => React.ReactNode;
}

export function KanbanColumn({
  title,
  statusColor,
  tasks,
  emptyLabel,
  footer,
  renderTask,
}: KanbanColumnProps) {
  const isEmpty = tasks.length === 0 && !footer;

  return (
    <section className={cn("h-full", BOARD_COLUMN_CLASS)}>
      <div className="sticky top-0 z-10 px-3 pt-3 pb-2">
        <ColumnHeader
          title={title}
          count={tasks.length}
          statusColorClass={statusColor}
        />
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-b-xl px-2 [scrollbar-gutter:stable] app-scrollbar scroll-edge-y",
          LIST_MOBILE_CREATE_FAB_CLEARANCE,
          "md:pb-2",
        )}
      >
        {tasks.map((task) =>
          renderTask ? (
            renderTask(task)
          ) : (
            <TaskCard key={task.id} task={task} />
          ),
        )}
        {footer}
        {isEmpty && (
          <div className="motion-safe:animate-in motion-safe:fade-in-0 flex flex-1 items-center justify-center py-8 duration-200">
            <p className="text-muted-foreground text-sm">{emptyLabel}</p>
          </div>
        )}
      </div>
    </section>
  );
}
