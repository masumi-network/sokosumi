import {
  TaskStatus,
  type TaskStatus as TaskStatusType,
} from "./task-status.js";

/**
 * User-initiated task status transitions. Mirrors the user branch of
 * `getAllowedTransitions` in Core (`apps/core/src/helpers/task.ts`).
 */
const USER_TASK_STATUS_TRANSITIONS: Record<
  TaskStatusType,
  readonly TaskStatusType[]
> = {
  [TaskStatus.DRAFT]: [
    TaskStatus.READY,
    TaskStatus.CANCELED,
    TaskStatus.QUEUED,
  ],
  [TaskStatus.QUEUED]: [TaskStatus.DRAFT, TaskStatus.READY],
  [TaskStatus.READY]: [
    TaskStatus.DRAFT,
    TaskStatus.CANCELED,
    TaskStatus.QUEUED,
  ],
  [TaskStatus.GRANT_PENDING]: [],
  [TaskStatus.INPUT_REQUIRED]: [TaskStatus.CANCELED],
  [TaskStatus.APPROVAL_REQUIRED]: [TaskStatus.CANCELED],
  [TaskStatus.AUTHENTICATION_REQUIRED]: [TaskStatus.CANCELED],
  [TaskStatus.OUT_OF_CREDITS]: [
    TaskStatus.CREDITS_TOPPED_UP,
    TaskStatus.CANCELED,
  ],
  [TaskStatus.CREDITS_TOPPED_UP]: [TaskStatus.CANCELED],
  [TaskStatus.RUNNING]: [TaskStatus.CANCELED],
  [TaskStatus.AWAITING_EXTERNAL]: [TaskStatus.CANCELED],
  [TaskStatus.COMPLETED]: [],
  [TaskStatus.FAILED]: [],
  // CANCELED is terminal for users; coworker agents may reopen via Core agent table.
  [TaskStatus.CANCELED]: [],
  [TaskStatus.CANCEL_REQUESTED]: [],
};

export function canUserTransitionTaskStatus(
  from: TaskStatusType,
  to: TaskStatusType,
): boolean {
  if (from === to) {
    return false;
  }

  return USER_TASK_STATUS_TRANSITIONS[from].includes(to);
}
