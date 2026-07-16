import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import {
  type TaskLinkRelation,
  TaskStatus,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import { TaskDetailLink } from "./task-detail-link";
import { getTaskLinkRelationIcon } from "./task-link-relation-icon";

interface TaskRelationRowProps {
  taskId: string;
  taskName: string;
  taskStatus: TaskStatus;
  relation: TaskLinkRelation;
  relationLabel?: string;
  relationTone?: "default" | "destructive";
}

function getFallbackRelationLabel(relation: TaskLinkRelation): string {
  switch (relation) {
    case "related":
      return "Related";
    case "blocks":
      return "Blocks";
    case "blocked_by":
      return "Blocked by";
    case "parent":
      return "Sub-task";
    case "child":
      return "Parent task";
    case "duplicate":
      return "Duplicate";
  }
}

export function TaskRelationRow({
  taskId,
  taskName,
  taskStatus,
  relation,
  relationLabel,
  relationTone = "default",
}: TaskRelationRowProps) {
  const RelationIcon = getTaskLinkRelationIcon(relation);
  const badgeLabel = relationLabel ?? getFallbackRelationLabel(relation);
  const iconBadge = (
    <span
      aria-label={badgeLabel}
      title={badgeLabel}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center",
        relationTone === "destructive"
          ? "text-destructive"
          : "text-muted-foreground",
      )}
    >
      <RelationIcon className="size-4" aria-hidden />
    </span>
  );

  return (
    <TaskDetailLink
      href={`/tasks/${taskId}`}
      className="bg-muted/40 border-border/50 hover:bg-muted/60 flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors"
    >
      <div className="flex min-w-0 items-center gap-2">
        {iconBadge}
        <p className="truncate text-sm">{taskName}</p>
      </div>
      <TaskStatusBadge status={taskStatus} className="shrink-0" />
    </TaskDetailLink>
  );
}
