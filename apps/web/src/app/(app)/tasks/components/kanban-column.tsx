import type { TaskCardData } from "@/app/tasks/types";

import { ColumnHeader } from "./column-header";
import { TaskCard } from "./task-card";

interface KanbanColumnProps {
  title: string;
  statusColor: string;
  tasks: TaskCardData[];
  taskLabels: {
    budget: string;
  };
  footer?: React.ReactNode;
}

export function KanbanColumn({
  title,
  statusColor,
  tasks,
  taskLabels,
  footer,
}: KanbanColumnProps) {
  return (
    <section className="bg-muted/40 flex min-w-[280px] flex-1 flex-col gap-3 rounded-xl p-3">
      <ColumnHeader
        title={title}
        count={tasks.length}
        statusColorClass={statusColor}
      />

      <div className="flex flex-1 flex-col gap-3">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} labels={taskLabels} />
        ))}
        {footer}
      </div>
    </section>
  );
}
