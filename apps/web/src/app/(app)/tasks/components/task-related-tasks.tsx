import { type TaskLinkRelation, TaskStatus } from "@sokosumi/core-client";

import { TaskRelationRow } from "./task-relation-row";

interface RelatedTaskSummary {
  id: string;
  name: string;
  identifier: string | null;
  status: TaskStatus;
  relation: TaskLinkRelation;
}

interface TaskRelatedTasksProps {
  title: string;
  tasks: RelatedTaskSummary[];
  relationLabels: Record<TaskLinkRelation, string>;
  statusLabels: Record<TaskStatus, string>;
}

/** Blockers first, then hierarchy (parent, sub-tasks), then the loose links. */
const RELATION_ORDER: readonly TaskLinkRelation[] = [
  "blocked_by",
  "blocks",
  "child",
  "parent",
  "related",
  "duplicate",
];

export function TaskRelatedTasks({
  title,
  tasks,
  relationLabels,
  statusLabels,
}: TaskRelatedTasksProps) {
  if (tasks.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
      {RELATION_ORDER.map((relation) => {
        const group = tasks.filter((task) => task.relation === relation);
        if (group.length === 0) return null;
        return (
          <div
            key={relation}
            role="group"
            aria-label={relationLabels[relation]}
            className="space-y-1"
          >
            <h3 className="text-muted-foreground text-xs">
              {relationLabels[relation]}
            </h3>
            <ul>
              {group.map((task) => (
                <li key={task.id}>
                  <TaskRelationRow
                    taskId={task.id}
                    taskName={task.name}
                    taskIdentifier={task.identifier}
                    taskStatus={task.status}
                    statusLabel={statusLabels[task.status]}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
