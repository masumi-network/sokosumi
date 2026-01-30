import type { TaskWithOrchestrator } from "@/lib/types/task";

import { ColumnHeader } from "./column-header";
import { TaskCard } from "./task-card";

interface KanbanColumnProps {
  title: string;
  statusColor: string;
  tasks: TaskWithOrchestrator[];
  footer?: React.ReactNode;
  renderTask?: (task: TaskWithOrchestrator) => React.ReactNode;
}

export function KanbanColumn({
  title,
  statusColor,
  tasks,
  footer,
  renderTask,
}: KanbanColumnProps) {
  return (
    <section className="bg-muted/40 flex min-w-[280px] flex-1 flex-col gap-3 rounded-xl p-3">
      <ColumnHeader
        title={title}
        count={tasks.length}
        statusColorClass={statusColor}
      />

      <div className="flex flex-1 flex-col gap-3">
        {tasks.map((task) =>
          renderTask ? (
            renderTask(task)
          ) : (
            <TaskCard key={task.id} task={task} />
          ),
        )}
        {footer}
      </div>
    </section>
  );
}
