import { TaskStatus } from "@sokosumi/utils";

import type { KanbanColumnId } from "@/lib/types/task";

/** Single source of truth for task status → kanban column. Used by getTasksColumnPage and mapTaskToTaskWithCoworker. */
export const COLUMN_TASK_STATUSES: Record<KanbanColumnId, TaskStatus[]> = {
  backlog: [TaskStatus.DRAFT, TaskStatus.QUEUED],
  todo: [TaskStatus.READY, TaskStatus.CREDITS_TOPPED_UP],
  "in-progress": [
    TaskStatus.RUNNING,
    TaskStatus.AWAITING_EXTERNAL,
    TaskStatus.CANCEL_REQUESTED,
  ],
  "input-required": [
    TaskStatus.INPUT_REQUIRED,
    TaskStatus.APPROVAL_REQUIRED,
    TaskStatus.AUTHENTICATION_REQUIRED,
    TaskStatus.OUT_OF_CREDITS,
  ],
  done: [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELED],
};

const STATUS_TO_COLUMN_ID = (() => {
  const map = new Map<TaskStatus, KanbanColumnId>();
  for (const [columnId, statuses] of Object.entries(COLUMN_TASK_STATUSES)) {
    for (const status of statuses) {
      map.set(status, columnId as KanbanColumnId);
    }
  }
  return map;
})();

interface GetColumnIdOptions {
  pendingApproval?: boolean;
}

/**
 * Resolves a task to its kanban column. Status is unchanged in the API; parked
 * READY tasks (`pendingApproval`) display in input-required only in the UI.
 */
export function getColumnId(
  status: TaskStatus,
  options?: GetColumnIdOptions,
): KanbanColumnId {
  if (options?.pendingApproval && status === TaskStatus.READY) {
    return "input-required";
  }

  return STATUS_TO_COLUMN_ID.get(status) ?? "todo";
}

/** Core list statuses to fetch for a column (may be broader than column membership). */
export function getColumnQueryStatuses(
  columnId: KanbanColumnId,
  statusFilter: TaskStatus | null,
): TaskStatus[] {
  const statuses = COLUMN_TASK_STATUSES[columnId].filter(
    (columnStatus) => statusFilter === null || columnStatus === statusFilter,
  );

  if (
    columnId === "input-required" &&
    (statusFilter === null || statusFilter === TaskStatus.READY) &&
    !statuses.includes(TaskStatus.READY)
  ) {
    return [...statuses, TaskStatus.READY];
  }

  return statuses;
}
