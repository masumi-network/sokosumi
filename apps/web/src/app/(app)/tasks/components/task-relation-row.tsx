import { TaskStatus } from "@sokosumi/core-client";
import { getTaskStatusMarker } from "@/app/tasks/components/task-status-badge";
import { taskLinkHref } from "@/app/tasks/utils/task-href";
import { getToneStyle, StatusMarker } from "@/components/ui/status-marker";

import { TaskDetailLink } from "./task-detail-link";

interface TaskRelationRowProps {
  taskId: string;
  taskName: string;
  taskIdentifier: string | null;
  taskStatus: TaskStatus;
  statusLabel: string;
  hrefBasePath?: string;
}

/** A sidebar row: status marker in the same 20px slot as the property rows, then the name. */
export function TaskRelationRow({
  taskId,
  taskName,
  taskIdentifier,
  taskStatus,
  statusLabel,
  hrefBasePath,
}: TaskRelationRowProps) {
  const marker = getTaskStatusMarker(taskStatus);
  const href = taskLinkHref(
    {
      id: taskId,
      identifier: taskIdentifier,
      name: taskName,
    },
    hrefBasePath,
  );

  return (
    <TaskDetailLink
      href={href}
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
