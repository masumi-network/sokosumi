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

/** Resolves a task status to its kanban column. Unknown statuses fall back to "todo". */
export function getColumnId(status: TaskStatus): KanbanColumnId {
  return STATUS_TO_COLUMN_ID.get(status) ?? "todo";
}
