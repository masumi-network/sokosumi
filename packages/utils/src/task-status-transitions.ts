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

/**
 * Task statuses referenced by status helpers. CREATED is not one: it is only
 * the first event of a Task, never a status any actor can move a Task to.
 *
 * Order matches Prisma `TaskStatus` minus `CREATED`.
 */
export const USER_TRANSITION_TASK_STATUSES = [
  "DRAFT",
  "QUEUED",
  "READY",
  "GRANT_PENDING",
  "INPUT_REQUIRED",
  "APPROVAL_REQUIRED",
  "AUTHENTICATION_REQUIRED",
  "OUT_OF_CREDITS",
  "CREDITS_TOPPED_UP",
  "RUNNING",
  "AWAITING_EXTERNAL",
  "COMPLETED",
  "FAILED",
  "CANCELED",
] as const;

export type UserTransitionTaskStatus =
  (typeof USER_TRANSITION_TASK_STATUSES)[number];

/** Who the Task is handed to. */
export type TaskAssigneeKind = "coworker" | "sokoBot" | "human" | "unset";

/**
 * Statuses that require a coworker or sokoBot assignee (queue, grants, HITL,
 * credits, failed). Human/unset tasks cannot enter these.
 */
const AGENT_ONLY_TASK_STATUSES = [
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
 * A person who sends a Task back to READY for a Coworker or Soko Bot must
 * say what to do next (SOK-631): from COMPLETED or CANCELED (a reopen), or
 * from INPUT_REQUIRED (an answer). A Task without an agent assignee reopens
 * with no comment. Enforced in Core on create-task-event for non-agent actors.
 */
export function userTaskStatusTransitionRequiresComment(
  from: UserTransitionTaskStatus,
  to: UserTransitionTaskStatus,
  hasAgentAssignee: boolean,
): boolean {
  return (
    hasAgentAssignee &&
    to === "READY" &&
    (from === "CANCELED" || from === "COMPLETED" || from === "INPUT_REQUIRED")
  );
}
