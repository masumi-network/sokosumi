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
  [TaskStatus.INPUT_REQUIRED]: [TaskStatus.CANCEL_REQUESTED],
  [TaskStatus.APPROVAL_REQUIRED]: [TaskStatus.CANCEL_REQUESTED],
  [TaskStatus.AUTHENTICATION_REQUIRED]: [TaskStatus.CANCEL_REQUESTED],
  [TaskStatus.OUT_OF_CREDITS]: [
    TaskStatus.CREDITS_TOPPED_UP,
    TaskStatus.CANCEL_REQUESTED,
  ],
  [TaskStatus.CREDITS_TOPPED_UP]: [TaskStatus.CANCEL_REQUESTED],
  [TaskStatus.RUNNING]: [TaskStatus.CANCEL_REQUESTED],
  [TaskStatus.AWAITING_EXTERNAL]: [TaskStatus.CANCEL_REQUESTED],
  [TaskStatus.COMPLETED]: [],
  [TaskStatus.FAILED]: [],
  // CANCELED is terminal: reopen would allow a second billing cycle.
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
