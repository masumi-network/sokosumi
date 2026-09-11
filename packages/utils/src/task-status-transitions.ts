/**
 * Task status helpers shared by Core and web.
 *
 * Free status transitions (SOK-1028): any status may move to any other when
 * the actor is authorized. Access, assignee, reopen-comment, parked, and seat
 * gates live in Core — not a transition matrix here.
 *
 * Implemented as string literals so this package does not mirror Prisma
 * `TaskStatus` enums — OpenAPI/codegen owns web runtime types.
 */

/** Task statuses referenced by status helpers. */
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

/** Who the Task is handed to. */
export type TaskAssigneeKind = "coworker" | "sokoBot" | "human" | "unset";

/**
 * Statuses that require a coworker or sokoBot assignee (queue, grants, HITL,
 * credits, failed). Human/unset tasks cannot enter these.
 */
export const AGENT_ONLY_TASK_STATUSES = [
  "QUEUED",
  "GRANT_PENDING",
  "INPUT_REQUIRED",
  "APPROVAL_REQUIRED",
  "AUTHENTICATION_REQUIRED",
  "OUT_OF_CREDITS",
  "CREDITS_TOPPED_UP",
  "FAILED",
] as const satisfies readonly UserTransitionTaskStatus[];

export function isAgentOnlyTaskStatus(status: string): boolean {
  return (AGENT_ONLY_TASK_STATUSES as readonly string[]).includes(status);
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
