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
  // Users may reopen COMPLETED → READY with a required comment (SOK-631).
  [TaskStatus.COMPLETED]: [TaskStatus.READY],
  [TaskStatus.FAILED]: [],
  // Users may reopen CANCELED → READY with a required comment (SOK-631).
  [TaskStatus.CANCELED]: [TaskStatus.READY],
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

/**
 * User reopen from terminal statuses to READY requires a non-empty comment
 * so the coworker knows what to do next (SOK-631). Enforced in Core on
 * create-task-event for non-agent actors.
 */
export function userTaskStatusTransitionRequiresComment(
  from: TaskStatusType,
  to: TaskStatusType,
): boolean {
  return (
    to === TaskStatus.READY &&
    (from === TaskStatus.CANCELED || from === TaskStatus.COMPLETED)
  );
}
