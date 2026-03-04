import { TaskStatus } from "@sokosumi/database";

import type { KanbanColumnId } from "@/lib/types/task";

export const COLUMN_TASK_STATUSES: Record<KanbanColumnId, TaskStatus[]> = {
  backlog: [TaskStatus.DRAFT],
  todo: [TaskStatus.READY, TaskStatus.CREDITS_TOPPED_UP],
  "in-progress": [
    TaskStatus.RUNNING,
    TaskStatus.AWAITING_EXTERNAL,
    TaskStatus.CANCEL_REQUESTED,
    TaskStatus.AUTHENTICATION_REQUIRED,
  ],
  "input-required": [TaskStatus.INPUT_REQUIRED, TaskStatus.OUT_OF_CREDITS],
  done: [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELED],
};
