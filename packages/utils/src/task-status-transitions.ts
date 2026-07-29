/**
 * User-initiated task status transitions. Mirrors the user branch of
 * `getAllowedTransitions` in Core (`apps/core/src/helpers/task.ts`).
 *
 * Implemented as string literals so this package does not mirror Prisma
 * `TaskStatus` enums — OpenAPI/codegen owns web runtime types.
 */

/** Task statuses referenced by the user transition table. */
export type UserTransitionTaskStatus =
  | "DRAFT"
  | "QUEUED"
  | "READY"
  | "GRANT_PENDING"
  | "INPUT_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "AUTHENTICATION_REQUIRED"
  | "OUT_OF_CREDITS"
  | "CREDITS_TOPPED_UP"
  | "RUNNING"
  | "AWAITING_EXTERNAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED";

const USER_TASK_STATUS_TRANSITIONS: Record<
  UserTransitionTaskStatus,
  readonly UserTransitionTaskStatus[]
> = {
  DRAFT: ["READY", "CANCELED", "QUEUED"],
  QUEUED: ["DRAFT", "READY", "CANCELED"],
  READY: ["DRAFT", "CANCELED", "QUEUED"],
  GRANT_PENDING: [],
  INPUT_REQUIRED: ["CANCELED"],
  APPROVAL_REQUIRED: ["CANCELED"],
  AUTHENTICATION_REQUIRED: ["CANCELED"],
  OUT_OF_CREDITS: ["CREDITS_TOPPED_UP", "CANCELED"],
  CREDITS_TOPPED_UP: ["CANCELED"],
  RUNNING: ["CANCELED"],
  AWAITING_EXTERNAL: ["CANCELED"],
  // Users may reopen COMPLETED → READY with a required comment (SOK-631).
  COMPLETED: ["READY"],
  FAILED: [],
  // Users may reopen CANCELED → READY with a required comment (SOK-631).
  CANCELED: ["READY"],
};

export function canUserTransitionTaskStatus(
  from: UserTransitionTaskStatus,
  to: UserTransitionTaskStatus,
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
  from: UserTransitionTaskStatus,
  to: UserTransitionTaskStatus,
): boolean {
  return to === "READY" && (from === "CANCELED" || from === "COMPLETED");
}
