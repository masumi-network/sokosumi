import {
  TaskStatus,
  type TaskStatus as TaskStatusType,
} from "@/lib/clients/generated/core";

/** Queued is only pickable for an agent assignee with a Run at (ADR 0041). */
export function canSelectQueuedTaskStatus(options: {
  hasRunAt: boolean;
  isAgent: boolean;
}): boolean {
  return options.hasRunAt && options.isAgent;
}

/** UI display order for task statuses (stats chips, label builders, etc.). */
export const TASK_STATUS_DISPLAY_ORDER = [
  TaskStatus.DRAFT,
  TaskStatus.QUEUED,
  TaskStatus.READY,
  TaskStatus.GRANT_PENDING,
  TaskStatus.INPUT_REQUIRED,
  TaskStatus.APPROVAL_REQUIRED,
  TaskStatus.AUTHENTICATION_REQUIRED,
  TaskStatus.OUT_OF_CREDITS,
  TaskStatus.CREDITS_TOPPED_UP,
  TaskStatus.RUNNING,
  TaskStatus.AWAITING_EXTERNAL,
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.CANCELED,
] as const satisfies readonly TaskStatusType[];

export type TaskStatusLabelKey = (typeof TASK_STATUS_DISPLAY_ORDER)[number];
