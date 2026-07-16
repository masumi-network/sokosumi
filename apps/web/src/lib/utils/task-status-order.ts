import {
  TaskStatus,
  type TaskStatus as TaskStatusType,
} from "@/lib/clients/generated/core";

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
  TaskStatus.CANCEL_REQUESTED,
  TaskStatus.CANCELED,
] as const satisfies readonly TaskStatusType[];

export type TaskStatusLabelKey = (typeof TASK_STATUS_DISPLAY_ORDER)[number];
