import { TaskStatus } from "@/lib/clients/generated/core";

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
    TaskStatus.GRANT_PENDING,
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

/** Resolves a task to its kanban column. */
export function getColumnId(status: TaskStatus): KanbanColumnId {
  return STATUS_TO_COLUMN_ID.get(status) ?? "todo";
}

/** Core list statuses to fetch for a column (may be broader than column membership). */
export function getColumnQueryStatuses(
  columnId: KanbanColumnId,
  statusFilter: TaskStatus | null,
): TaskStatus[] {
  return getColumnListQueryOptions(columnId, statusFilter).statuses;
}

export interface ColumnListQueryOptions {
  statuses: TaskStatus[];
}

export function getColumnListQueryOptions(
  columnId: KanbanColumnId,
  statusFilter: TaskStatus | null,
): ColumnListQueryOptions {
  const statuses = COLUMN_TASK_STATUSES[columnId].filter(
    (columnStatus) => statusFilter === null || columnStatus === statusFilter,
  );

  return { statuses };
}
