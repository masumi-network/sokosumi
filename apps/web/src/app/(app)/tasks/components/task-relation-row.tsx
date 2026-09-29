import { TaskStatus } from "@sokosumi/core-client";
import { getTaskStatusMarker } from "@/app/tasks/components/task-status-badge";
import { getToneStyle, StatusMarker } from "@/components/ui/status-marker";

import { TaskDetailLink } from "./task-detail-link";

interface TaskRelationRowProps {
  taskId: string;
  taskName: string;
  taskStatus: TaskStatus;
  statusLabel: string;
}

/** A sidebar row: status marker in the same 20px slot as the property rows, then the name. */
export function TaskRelationRow({
  taskId,
  taskName,
  taskStatus,
  statusLabel,
}: TaskRelationRowProps) {
  const marker = getTaskStatusMarker(taskStatus);

  return (
    <TaskDetailLink
      href={`/tasks/${taskId}`}
      className="hover:bg-muted -mx-2 flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors"
    >
      <span
        role="img"
        aria-label={statusLabel}
        title={statusLabel}
        className="flex size-5 shrink-0 items-center justify-center"
      >
        <StatusMarker
          spec={marker}
          tone={getToneStyle(marker.tone).labelOnSurface}
        />
      </span>
      <span className="truncate">{taskName}</span>
    </TaskDetailLink>
  );
}
