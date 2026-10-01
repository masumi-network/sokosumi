import type { TaskLinkRelation, TaskStatus } from "@sokosumi/core-client";

import type { VisibleTaskLink } from "./task-detail-api-types";
import { TaskRelationRow } from "./task-relation-row";

interface TaskRelatedTasksProps {
  title: string;
  tasks: VisibleTaskLink[];
  relationLabels: Record<TaskLinkRelation, string>;
  statusLabels: Record<TaskStatus, string>;
  hrefBasePath?: string;
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
  hrefBasePath,
}: TaskRelatedTasksProps) {
  if (tasks.length === 0) return null;

  const groups = new Map<TaskLinkRelation, VisibleTaskLink[]>();
  for (const task of tasks) {
    const group = groups.get(task.relation);
    if (group) {
      group.push(task);
    } else {
      groups.set(task.relation, [task]);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
      {RELATION_ORDER.map((relation) => {
        const group = groups.get(relation);
        if (!group?.length) return null;
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
                    hrefBasePath={hrefBasePath}
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
