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
  TaskStatus.CANCELED,
] as const satisfies readonly TaskStatusType[];

export type TaskStatusLabelKey = (typeof TASK_STATUS_DISPLAY_ORDER)[number];

/** Not user-pickable in manual status selects; badges/filters/kanban keep them. */
export const TASK_STATUSES_HIDDEN_FROM_MANUAL_SELECT = [
  TaskStatus.GRANT_PENDING,
  TaskStatus.AUTHENTICATION_REQUIRED,
  TaskStatus.OUT_OF_CREDITS,
  TaskStatus.CREDITS_TOPPED_UP,
  TaskStatus.FAILED,
] as const satisfies readonly TaskStatusType[];

const HIDDEN_FROM_MANUAL_SELECT = new Set<TaskStatusType>(
  TASK_STATUSES_HIDDEN_FROM_MANUAL_SELECT,
);

export function getManualTaskStatusSelectOptions(
  currentStatus?: TaskStatusType,
): readonly TaskStatusType[] {
  return TASK_STATUS_DISPLAY_ORDER.filter(
    (status) =>
      !HIDDEN_FROM_MANUAL_SELECT.has(status) || status === currentStatus,
  );
}
