import { TaskStatus } from "@/lib/clients/generated/core";

import type { TaskLinkRelation } from "@/lib/clients/generated/core/types.gen";

import { TaskRelationRow } from "./task-relation-row";

interface RelatedTaskSummary {
  id: string;
  name: string;
  status: TaskStatus;
  relation: TaskLinkRelation;
}

interface TaskRelatedTasksProps {
  title: string;
  emptyLabel: string;
  tasks: RelatedTaskSummary[];
  relationLabels: Record<TaskLinkRelation, string>;
}

export function TaskRelatedTasks({
  title,
  emptyLabel,
  tasks,
  relationLabels,
}: TaskRelatedTasksProps) {
  return (
    <section className="space-y-4">
      <h2 className="text-muted-foreground/60 text-xs font-medium">{title}</h2>

      {tasks.length === 0 ? (
        <p className="text-muted-foreground text-sm">{emptyLabel}</p>
      ) : (
        <ul className="space-y-3">
          {tasks.map((task) => (
            <li key={`${task.relation}-${task.id}`}>
              <TaskRelationRow
                taskId={task.id}
                taskName={task.name}
                taskStatus={task.status}
                relation={task.relation}
                relationLabel={relationLabels[task.relation]}
                relationTone={
                  task.relation === "blocks" || task.relation === "blocked_by"
                    ? "destructive"
                    : "default"
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
